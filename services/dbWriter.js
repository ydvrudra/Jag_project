// services/dbWriter.js
require("dotenv").config();
const sql = require("mssql");

const sqlCfg = {
  user: process.env.SQLSERVER_USER,
  password: process.env.SQLSERVER_PASSWORD,
  server: process.env.SQLSERVER_SERVER || "localhost",
  port: Number(process.env.SQLSERVER_PORT) || 1433,
  database: process.env.SQLSERVER_DATABASE,
  options: { trustServerCertificate: (process.env.SQLSERVER_TRUSTCERT || "true") === "true" },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};
const pool = new sql.ConnectionPool(sqlCfg);
const poolConnect = pool.connect();
const { parseAmount, cleanText, invoiceKey } = require("../helpers/common");

    
// Helper: Convert a value into formatted string number
function toStringNumber(value) {
  const num = parseAmount(value);
  return (typeof num === "number" && !isNaN(num)) ? num.toFixed(2) : "0.00";
}

// Helper: Prioritize OCR value, else fallback to already mapped allRows
function getContent(fieldObj, rowBackup, colName) {
  let val = fieldObj?.valueString ?? fieldObj?.content ?? rowBackup?.[colName] ?? null;

  if (val === null) return null;

  // Agar val object hai (aur na string na number), toh return null ya "Not Available"
  if (typeof val === "object") return null;  // ya return "Not Available";

  return val.toString().trim();
}


async function writeToSqlAndFillIds(dataArray, allRows, groupMap) {
  const pool = await sql.connect(sqlCfg);
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    for (const item of dataArray) {
      const doc = item.full_json?.documents?.[0] || {};
      const f = doc.fields || {};
      const file = item.file || "";
      const invNo = f["INVOICE NUMBER"]?.content || "";
      const suppGst = f["SUPPLIER GST"]?.content || "";
      const key = invoiceKey(file, invNo, suppGst);
      const group = groupMap.get(key);
      if (!group) continue;

      // Calculate totals from allRows using row indexes
      let totalIGST = 0, totalSGST = 0, totalCGST = 0;
      group.rowIndexes.forEach(idx => {
        totalIGST += Number(allRows[idx]["IGST_AMOUNT"] || 0);
        totalSGST += Number(allRows[idx]["SGST_AMOUNT"] || 0);
        totalCGST += Number(allRows[idx]["CGST_AMOUNT"] || 0);
      });
      const totalGST = totalIGST + totalSGST + totalCGST;

      // Insert or update invoice record
      const find = new sql.Request(tx);
      find.input("invoice_number", sql.VarChar(100), invNo || null);
      find.input("supplier_gst", sql.VarChar(32), suppGst || null);
      find.input("filename", sql.VarChar(255), file || null);

      const existing = await find.query(`
        SELECT TOP 1 invoice_id FROM dbo.invoices
        WHERE invoice_number=@invoice_number AND supplier_gst=@supplier_gst AND filename=@filename
      `);

      let invoiceId;

      if (existing.recordset.length) {
        invoiceId = existing.recordset[0].invoice_id;
        const upd = new sql.Request(tx);
        upd.input("invoice_id", sql.Int, invoiceId);
        upd.input("total_igst", sql.VarChar(50), totalIGST.toFixed(2));
        upd.input("total_sgst", sql.VarChar(50), totalSGST.toFixed(2));
        upd.input("total_cgst", sql.VarChar(50), totalCGST.toFixed(2));
        upd.input("total_gst", sql.VarChar(50), totalGST.toFixed(2));

        await upd.query(`
          UPDATE dbo.invoices
          SET total_igst=@total_igst,
              total_sgst=@total_sgst,
              total_cgst=@total_cgst,
              total_gst=@total_gst
          WHERE invoice_id=@invoice_id;
        `);
      } else {
        const ins = new sql.Request(tx);
        ins.input("filename", sql.VarChar(255), file || null);
        ins.input("document_confidence", sql.Decimal(6, 3), doc.confidence ?? null);
        ins.input("supplier_name", sql.VarChar(255), cleanText(f["SUPPLIER NAME"]?.content));
        ins.input("invoice_number", sql.VarChar(100), invNo || null);
        ins.input("invoice_date", sql.VarChar(50), f["INVOICE DATE"]?.content || null);
        ins.input("supplier_gst", sql.VarChar(32), suppGst || null);
        ins.input("supplier_address", sql.NVarChar(sql.MAX), cleanText(f["SUPPLIER ADDRESS"]?.content));
        ins.input("bl_number", sql.VarChar(100), f["BL NUMBER"]?.content || null);

        ins.input("total_igst", sql.VarChar(50), totalIGST.toFixed(2));
        ins.input("total_sgst", sql.VarChar(50), totalSGST.toFixed(2));
        ins.input("total_cgst", sql.VarChar(50), totalCGST.toFixed(2));
        ins.input("total_gst", sql.VarChar(50), totalGST.toFixed(2));
        ins.input("total_amount", sql.VarChar(50), toStringNumber(f["TOTAL AMOUNT"]?.valueString ?? f["TOTAL AMOUNT"]?.content));
        ins.input("customer_gst", sql.VarChar(32), f["CUSTOMER GST"]?.content ?? null);
        ins.input("customer_name", sql.VarChar(255), cleanText(f["CUSTOMER NAME"]?.content));
        ins.input("customer_address", sql.NVarChar(sql.MAX), cleanText(f["CUSTOMER ADDRESS"]?.content));

        const out = await ins.query(`
          INSERT INTO dbo.invoices
          (filename, document_confidence, supplier_name, invoice_number, invoice_date,
           supplier_gst, supplier_address, bl_number, total_igst, total_sgst, total_cgst,
           total_gst, total_amount, customer_gst, customer_name, customer_address)
          OUTPUT INSERTED.invoice_id
          VALUES (@filename, @document_confidence, @supplier_name, @invoice_number, @invoice_date,
                  @supplier_gst, @supplier_address, @bl_number, @total_igst, @total_sgst, @total_cgst,
                  @total_gst, @total_amount, @customer_gst, @customer_name, @customer_address);
        `);
        invoiceId = out.recordset[0].invoice_id;
      }

      // Attach invoice ID to all relevant rows
      group.rowIndexes.forEach(idx => {
        allRows[idx]["INVOICE ID"] = invoiceId;
      });

      // Delete old child rows
      await new sql.Request(tx)
        .input("invoice_id", sql.Int, invoiceId)
        .query(`DELETE FROM dbo.invoicelineitems WHERE invoice_id=@invoice_id;`);

      // Insert new child line items
      const items = f["LineItems"]?.valueArray || [];
      for (let i = 0; i < items.length; i++) {
        const line = items[i];
        const o = line.valueObject || {};
        const idx = group.rowIndexes[i]; // matching overall row index
        const rowBackup = allRows[idx] || {};

        //console.log("🔎 Raw line item:", JSON.stringify(o, null, 2));

        const insertPayload = {
          invoice_id: invoiceId,
          size: getContent(o["SIZE"], rowBackup, "SIZE"),
          type: getContent(o["TYPE"], rowBackup, "TYPE"),
          charges_description: getContent(o["CHARGE_DESCRIPTION"], rowBackup, "CHARGE_DESCRIPTION"),
          hsn_sac: getContent(o["HSN_SAC_CODE"], rowBackup, "HSN_SAC_CODE") || getContent(o["HSN/SAC"], rowBackup, "HSN/SAC"),
          tax: getContent(o["TAX"], rowBackup, "TAX"),
          based_on: getContent(o["BASED ON"], rowBackup, "BASED ON"),
          rate: toStringNumber(getContent(o["RATE"], rowBackup, "RATE")),
          currency: getContent(o["CURRENCY"], rowBackup, "CURRENCY"),
          taxable_amount: toStringNumber(
            getContent(o["TAXABLE_AMOUNT"], rowBackup, "TAXABLE_AMOUNT") ||
            getContent(o["TAXABLE AMOUNT"], rowBackup, "TAXABLE AMOUNT") ||
            getContent(o["AMOUNT"], rowBackup, "AMOUNT")
          ),
          igst_percent: getContent(o["IGST%"], rowBackup, "IGST%"),
          igst_amount: toStringNumber(getContent(o["IGST_AMOUNT"], rowBackup, "IGST_AMOUNT")),
          sgst_percent: getContent(o["SGST%"], rowBackup, "SGST%"),
          sgst_amount: toStringNumber(getContent(o["SGST_AMOUNT"], rowBackup, "SGST_AMOUNT")),
          cgst_percent: getContent(o["CGST%"], rowBackup, "CGST%"),
          cgst_amount: toStringNumber(getContent(o["CGST_AMOUNT"], rowBackup, "CGST_AMOUNT")),
        };

       // console.log("📥 Mapped DB line item:", insertPayload);

        const insChild = new sql.Request(tx);
        insChild.input("invoice_id", sql.Int, invoiceId);
        insChild.input("size", sql.VarChar(50), insertPayload.size);
        insChild.input("type", sql.VarChar(50), insertPayload.type);
        insChild.input("charges_description", sql.VarChar(255), insertPayload.charges_description);
        insChild.input("hsn_sac", sql.VarChar(50), insertPayload.hsn_sac);
        insChild.input("tax", sql.VarChar(20), insertPayload.tax);
        insChild.input("based_on", sql.VarChar(50), insertPayload.based_on);
        insChild.input("rate", sql.VarChar(50), insertPayload.rate);
        insChild.input("currency", sql.VarChar(10), insertPayload.currency);
        insChild.input("taxable_amount", sql.VarChar(50), insertPayload.taxable_amount);
        insChild.input("igst_percent", sql.VarChar(50), insertPayload.igst_percent);
        insChild.input("igst_amount", sql.VarChar(50), insertPayload.igst_amount);
        insChild.input("sgst_percent", sql.VarChar(50), insertPayload.sgst_percent);
        insChild.input("sgst_amount", sql.VarChar(50), insertPayload.sgst_amount);
        insChild.input("cgst_percent", sql.VarChar(50), insertPayload.cgst_percent);
        insChild.input("cgst_amount", sql.VarChar(50), insertPayload.cgst_amount);

        await insChild.query(`
          INSERT INTO dbo.invoicelineitems
          (invoice_id, size, type, charges_description, hsn_sac, tax, based_on, rate, currency, taxable_amount,
           igst_percent, igst_amount, sgst_percent, sgst_amount, cgst_percent, cgst_amount)
          VALUES (@invoice_id, @size, @type, @charges_description, @hsn_sac, @tax, @based_on, @rate, @currency, @taxable_amount,
                  @igst_percent, @igst_amount, @sgst_percent, @sgst_amount, @cgst_percent, @cgst_amount);
        `);
      }
    }

    await tx.commit();
    pool.close();
  } catch (err) {
    console.error("Error in writeToSqlAndFillIds:", err);
    await tx.rollback();
    sql.close();
    throw err;
  }
}

module.exports = { writeToSqlAndFillIds ,sql, pool, poolConnect};