// services/dbWriter.js
require("dotenv").config();
const sql = require("mssql");
const { parseAmount, cleanText, invoiceKey } = require("../helpers/common");

const sqlCfg = {
  user: process.env.SQLSERVER_USER,
  password: process.env.SQLSERVER_PASSWORD,
  server: process.env.SQLSERVER_SERVER || "localhost",
  port: Number(process.env.SQLSERVER_PORT) || 1433,
  database: process.env.SQLSERVER_DATABASE,
  options: { trustServerCertificate: (process.env.SQLSERVER_TRUSTCERT || "true") === "true" },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

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

      // find existing
      const find = new sql.Request(tx);
      find.input("invoice_number", sql.VarChar(100), invNo || null);
      find.input("supplier_gst",  sql.VarChar(32),  suppGst || null);
      find.input("filename",      sql.VarChar(255), file || null);
      const existing = await find.query(`
        SELECT TOP 1 invoice_id FROM dbo.invoices
        WHERE invoice_number=@invoice_number AND supplier_gst=@supplier_gst AND filename=@filename
      `);

      let invoiceId;
      if (existing.recordset.length) {
        invoiceId = existing.recordset[0].invoice_id;
      } else {
        const ins = new sql.Request(tx);
        ins.input("filename",            sql.VarChar(255), file || null);
        ins.input("document_confidence", sql.Decimal(6,3), doc.confidence ?? null);
        ins.input("supplier_name",       sql.VarChar(255), cleanText(f["SUPPLIER NAME"]?.content));
        ins.input("invoice_number",      sql.VarChar(100), invNo || null);
        ins.input("invoice_date",        sql.VarChar(50),  f["INVOICE DATE"]?.content || null);
        ins.input("supplier_gst",        sql.VarChar(32),  suppGst || null);
        ins.input("supplier_address",    sql.NVarChar(sql.MAX), cleanText(f["SUPPLIER ADDRESS"]?.content));
        ins.input("bl_number",           sql.VarChar(100), f["BL NUMBER"]?.content || null);
        ins.input("total_igst",          sql.Decimal(15,2), 0);
        ins.input("total_sgst",          sql.Decimal(15,2), 0);
        ins.input("total_cgst",          sql.Decimal(15,2), 0);
        ins.input("total_gst",           sql.Decimal(15,2), 0);
        ins.input("total_amount",        sql.Decimal(15,2), parseAmount(f["TOTAL AMOUNT"]?.valueString ?? f["TOTAL AMOUNT"]?.content));
        ins.input("customer_gst",        sql.VarChar(32),  f["CUSTOMER GST"]?.content ?? null);
        ins.input("customer_name",       sql.VarChar(255), cleanText(f["CUSTOMER NAME"]?.content));
        ins.input("customer_address",    sql.NVarChar(sql.MAX), cleanText(f["CUSTOMER ADDRESS"]?.content));

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

      // write back invoiceId to all rows in group
      for (const idx of group.rowIndexes) allRows[idx]["INVOICE ID"] = invoiceId;

      // reset child rows then insert fresh
      const del = new sql.Request(tx);
      del.input("invoice_id", sql.Int, invoiceId);
      await del.query(`DELETE FROM dbo.invoicelineitems WHERE invoice_id=@invoice_id;`);

      const items = f["LineItems"]?.valueArray || [];
      for (const line of items) {
        const o = line.valueObject || {};
        const insChild = new sql.Request(tx);
        insChild.input("invoice_id",          sql.Int, invoiceId);
        insChild.input("size",                sql.VarChar(50),  o["SIZE"]?.content ?? null);
        insChild.input("type",                sql.VarChar(50),  o["TYPE"]?.content ?? null);
        insChild.input("charges_description", sql.VarChar(255), o["CHARGE_DESCRIPTION"]?.content ?? o["CHARGES DESCRIPTION"]?.content ?? null);
        insChild.input("hsn_sac",             sql.VarChar(50),  o["HSN_SAC_CODE"]?.content ?? o["HSN/SAC"]?.content ?? null);
        insChild.input("tax",                 sql.VarChar(20),  o["TAX"]?.content ?? null);
        insChild.input("based_on",            sql.VarChar(50),  o["BASED ON"]?.content ?? null);
        insChild.input("rate",                sql.Decimal(15,2), parseAmount(o["RATE"]?.valueString ?? o["RATE"]?.content));
        insChild.input("currency",            sql.VarChar(10),  o["CURRENCY"]?.content ?? null);
        insChild.input("taxable_amount",      sql.Decimal(15,2), parseAmount(o["TAXABLE AMOUNT"]?.valueString ?? o["TAXABLE AMOUNT"]?.content ?? o["AMOUNT"]?.content));
        insChild.input("igst_percent",        sql.VarChar(10),  o["IGST %"]?.valueString ?? o["IGST %"]?.content ?? null);
        insChild.input("igst_amount",         sql.Decimal(15,2), parseAmount(o["IGST_AMOUNT"]?.valueString ?? o["IGST_AMOUNT"]?.content));
        insChild.input("sgst_percent",        sql.VarChar(10),  o["SGST %"]?.valueString ?? o["SGST %"]?.content ?? o["SGST%"]?.content ?? null);
        insChild.input("sgst_amount",         sql.Decimal(15,2), parseAmount(o["SGST_AMOUNT"]?.valueString ?? o["SGST_AMOUNT"]?.content));
        insChild.input("cgst_percent",        sql.VarChar(10),  o["CGST %"]?.valueString ?? o["CGST %"]?.content ?? o["CGST%"]?.content ?? null);
        insChild.input("cgst_amount",         sql.Decimal(15,2), parseAmount(o["CGST_AMOUNT"]?.valueString ?? o["CGST_AMOUNT"]?.content));

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
