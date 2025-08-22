require("dotenv").config();
const sql = require("mssql");
const { parseAmount, cleanText, invoiceKey } = require("../helpers/common");

// Import vendor mappers
const cma = require("../vendors/cma");
const hapag = require("../vendors/hapag");
const maersk = require("../vendors/maersk");
const msc = require("../vendors/msc");

// Map vendor names to their mappers
const VENDOR_MAPPERS = {
  cma,
  hapag,
  maersk,
  msc,
};

// Utility: simple vendor detect from filename or other metadata
function detectVendor(filename = "") {
  filename = filename.toLowerCase();
  if (filename.includes("cma")) return "cma";
  if (filename.includes("hapag")) return "hapag";
  if (filename.includes("maersk")) return "maersk";
  if (filename.includes("msc")) return "msc";
  return null;
}

const sqlCfg = {
  user: process.env.SQLSERVER_USER,
  password: process.env.SQLSERVER_PASSWORD,
  server: process.env.SQLSERVER_SERVER || "localhost",
  port: Number(process.env.SQLSERVER_PORT) || 1433,
  database: process.env.SQLSERVER_DATABASE,
  options: { trustServerCertificate: (process.env.SQLSERVER_TRUSTCERT || "true") === "true" },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

function toStringNumber(value) {
  const num = parseAmount(value);
  return (typeof num === "number" && !isNaN(num)) ? num.toFixed(2) : "0.00";
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

      // Compute totals from allRows
      let totalIGST = 0, totalSGST = 0, totalCGST = 0;
      group.rowIndexes.forEach(idx => {
        totalIGST += Number(allRows[idx]["IGST_AMOUNT"] || 0);
        totalSGST += Number(allRows[idx]["SGST_AMOUNT"] || 0);
        totalCGST += Number(allRows[idx]["CGST_AMOUNT"] || 0);
      });
      const totalGST = totalIGST + totalSGST + totalCGST;

      // SQL find and insert/update invoices table
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

      // Backfill invoiceId in allRows
      group.rowIndexes.forEach(idx => {
        allRows[idx]["INVOICE ID"] = invoiceId;
      });

      // Delete old child line items
      const del = new sql.Request(tx);
      del.input("invoice_id", sql.Int, invoiceId);
      await del.query(`DELETE FROM dbo.invoicelineitems WHERE invoice_id=@invoice_id;`);

      // Detect vendor and get corresponding mapper
      const vendor = detectVendor(file);
      const mapper = VENDOR_MAPPERS[vendor];

      // Insert new child line items, mapped via vendor mapper
      const items = f["LineItems"]?.valueArray || [];
      for (const line of items) {
        // Raw line object
        const rawLine = line.valueObject || {};

        

        // Use mapper if available else fallback to raw line
        const mappedLine = mapper ? mapper.mapLineItem(line) : {
          "SIZE": rawLine["SIZE"]?.content ?? null,
          "TYPE": rawLine["TYPE"]?.content ?? null,
          "CHARGES DESCRIPTION": rawLine["CHARGE_DESCRIPTION"]?.content ?? rawLine["CHARGES DESCRIPTION"]?.content ?? null,
          "HSN/SAC": rawLine["HSN_SAC_CODE"]?.content ?? rawLine["HSN/SAC"]?.content ?? null,
          "TAX": rawLine["TAX"]?.content ?? null,
          "BASED ON": rawLine["BASED ON"]?.content ?? null,
          "RATE": rawLine["RATE"]?.valueString ?? rawLine["RATE"]?.content ?? null,
          "CURRENCY": rawLine["CURRENCY"]?.content ?? null,
          "TAXABLE AMOUNT": rawLine["TAXABLE AMOUNT"]?.valueString ?? rawLine["TAXABLE AMOUNT"]?.content ?? null,
          "IGST %": rawLine["IGST %"]?.valueString ?? rawLine["IGST %"]?.content ?? null,
          "IGST_AMOUNT": rawLine["IGST_AMOUNT"]?.valueString ?? rawLine["IGST_AMOUNT"]?.content ?? null,
          "SGST %": rawLine["SGST %"]?.valueString ?? rawLine["SGST %"]?.content ?? null,
          "SGST_AMOUNT": rawLine["SGST_AMOUNT"]?.valueString ?? rawLine["SGST_AMOUNT"]?.content ?? null,
          "CGST %": rawLine["CGST %"]?.valueString ?? rawLine["CGST %"]?.content ?? null,
          "CGST_AMOUNT": rawLine["CGST_AMOUNT"]?.valueString ?? rawLine["CGST_AMOUNT"]?.content ?? null,
        };

        // Insert mapped line item
        const insChild = new sql.Request(tx);
        const igstPctValue = mappedLine["IGST %"];
          const cgstPctValue = mappedLine["CGST %"];
          const sgstPctValue = mappedLine["SGST %"];
          const taxableAmtValue = mappedLine["TAXABLE AMOUNT"];
        insChild.input("invoice_id", sql.Int, invoiceId);
        insChild.input("size", sql.VarChar(50), mappedLine["SIZE"] ?? null);
        insChild.input("type", sql.VarChar(50), mappedLine["TYPE"] ?? null);
        insChild.input("charges_description", sql.VarChar(255), mappedLine["CHARGES DESCRIPTION"] ?? null);
        insChild.input("hsn_sac", sql.VarChar(50), mappedLine["HSN/SAC"] ?? null);
        insChild.input("tax", sql.VarChar(20), mappedLine["TAX"] ?? null);
        insChild.input("based_on", sql.VarChar(50), mappedLine["BASED ON"] ?? null);
        insChild.input("rate", sql.VarChar(50), toStringNumber(mappedLine["RATE"]));
        insChild.input("currency", sql.VarChar(10), mappedLine["CURRENCY"] ?? null);
       insChild.input("igst_percent", sql.VarChar(50), igstPctValue !== undefined ? toStringNumber(igstPctValue) : "");
        insChild.input("igst_amount", sql.VarChar(50), toStringNumber(mappedLine["IGST_AMOUNT"]));
        insChild.input("sgst_percent", sql.VarChar(50), sgstPctValue !== undefined ? toStringNumber(sgstPctValue) : "");
        insChild.input("sgst_amount", sql.VarChar(50), toStringNumber(mappedLine["SGST_AMOUNT"]));
        insChild.input("cgst_percent", sql.VarChar(50), cgstPctValue !== undefined ? toStringNumber(cgstPctValue) : "");
        insChild.input("cgst_amount", sql.VarChar(50), toStringNumber(mappedLine["CGST_AMOUNT"]));
        insChild.input("taxable_amount", sql.VarChar(50), taxableAmtValue !== undefined ? toStringNumber(taxableAmtValue) : "");
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
    await tx.rollback();
    sql.close();
    throw err;
  }
}

module.exports = { writeToSqlAndFillIds };
