require("dotenv").config();
const fs = require("fs");
const XLSX = require("xlsx");
const sql = require("mssql");
const { extractedExcelFile } = require("../config/constants");
const { isHapagLloydInvoice, applyHapagLloydTaxMapping } = require("./hapagHelper");

// ---------- SQL Server pool ----------
const sqlCfg = {
  user: process.env.SQLSERVER_USER,
  password: process.env.SQLSERVER_PASSWORD,
  server: process.env.SQLSERVER_SERVER || "localhost",
  port: Number(process.env.SQLSERVER_PORT) || 1433,            // ✅ add this
  database: process.env.SQLSERVER_DATABASE,
  options: {
    trustServerCertificate: (process.env.SQLSERVER_TRUSTCERT || "true") === "true",
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

// ---------- Excel columns ----------
const PARENT_COLUMNS = [
  "INVOICE ID","FILENAME","DOCUMENT CONFIDENCE","SUPPLIER NAME","INVOICE NUMBER","INVOICE DATE",
  "SUPPLIER GST","SUPPLIER ADDRESS","BL NUMBER","TOTAL IGST","TOTAL SGST","TOTAL CGST","TOTAL GST",
  "TOTAL AMOUNT","CUSTOMER GST","CUSTOMER NAME","CUSTOMER ADDRESS"
];
const CHILD_COLUMNS = [
  "SIZE","TYPE","CHARGES DESCRIPTION","HSN/SAC","TAX","BASED ON",
  "RATE","CURRENCY","TAXABLE AMOUNT","IGST %","IGST_AMOUNT","SGST %","SGST_AMOUNT","CGST %","CGST_AMOUNT"
];

function parseAmount(val) {
  if (!val && val !== 0) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val.replace(/,/g, "").replace(/[^\d.-]/g, "")) || 0;
  return 0;
}
function cleanText(value) {
  return (value || "").replace(/\n/g, ", ").replace(/\s+/g, " ").trim();
}

// Build a stable key per invoice (to tie Excel rows to DB insert)
function invoiceKey(file, invNo, suppGst) {
  return [file || "", invNo || "", suppGst || ""].join("|").toLowerCase();
}

// ============== MAIN EXPORTER ==============
async function saveToExcel(dataArray) {
  // 1) Build all Excel rows and group indices by invoice
  const allRows = [];
  const groupMap = new Map(); // key -> { parentRowIndex, rowIndexes[] }

  dataArray.forEach((item) => {
    const doc = item.full_json?.documents?.[0] || {};
    const fields = doc.fields || {};
    const confidence = doc?.confidence || "";
    const isHapag = isHapagLloydInvoice(fields);

    const file = item.file || "";
    const invNo = fields["INVOICE NUMBER"]?.content || "";
    const suppGst = fields["SUPPLIER GST"]?.content || "";
    const key = invoiceKey(file, invNo, suppGst);

    const baseParent = {
      "INVOICE ID": "", // <-- leave empty; fill from DB identity later
      "FILENAME": file,
      "DOCUMENT CONFIDENCE": confidence,
      "SUPPLIER NAME": cleanText(fields["SUPPLIER NAME"]?.content),
      "INVOICE NUMBER": invNo,
      "INVOICE DATE": fields["INVOICE DATE"]?.content || "",
      "SUPPLIER GST": suppGst,
      "SUPPLIER ADDRESS": cleanText(fields["SUPPLIER ADDRESS"]?.content),
      "BL NUMBER": fields["BL NUMBER"]?.content || "",
      "TOTAL IGST": 0,
      "TOTAL SGST": 0,
      "TOTAL CGST": 0,
      "TOTAL GST": 0,
      "TOTAL AMOUNT": 0,
      "CUSTOMER GST": fields["CUSTOMER GST"]?.content || "",
      "CUSTOMER NAME": cleanText(fields["CUSTOMER NAME"]?.content),
      "CUSTOMER ADDRESS": cleanText(fields["CUSTOMER ADDRESS"]?.content),
    };

    const items = fields["LineItems"]?.valueArray || [];
    let totalIGST = 0, totalSGST = 0, totalCGST = 0, totalTaxable = 0;
    let isFirstRow = true;

    items.forEach((line) => {
      let f = line.valueObject || {};
      if (isHapag) f = applyHapagLloydTaxMapping(line); // mapping returns filled object
      const igstAmt = parseAmount(f["IGST_AMOUNT"]?.valueString ?? f["IGST_AMOUNT"]?.content);
      const sgstAmt = parseAmount(f["SGST_AMOUNT"]?.valueString ?? f["SGST_AMOUNT"]?.content);
      const cgstAmt = parseAmount(f["CGST_AMOUNT"]?.valueString ?? f["CGST_AMOUNT"]?.content);
      const taxable = parseAmount(f["TAXABLE AMOUNT"]?.valueString ?? f["TAXABLE AMOUNT"]?.content);

      totalIGST += igstAmt;
      totalSGST += sgstAmt;
      totalCGST += cgstAmt;
      totalTaxable += taxable;

      const row = {
        ...(isFirstRow ? baseParent : Object.fromEntries(PARENT_COLUMNS.map(col => [col, ""]))),
        "SIZE": f["SIZE"]?.content ?? "",
        "TYPE": f["TYPE"]?.content ?? "",
        "CHARGES DESCRIPTION": f["CHARGE_DESCRIPTION"]?.content ?? "",
        "HSN/SAC": f["HSN_SAC_CODE"]?.content ?? "",
        "TAX": f["TAX"]?.content ?? "",
        "BASED ON": f["BASED ON"]?.content ?? "",
        "RATE": f["RATE"]?.valueString ?? f["RATE"]?.content ?? "",
        "CURRENCY": f["CURRENCY"]?.content ?? "",
        "TAXABLE AMOUNT": taxable,
        "IGST %": f["IGST %"]?.content ?? "",
        "IGST_AMOUNT": igstAmt,
        "SGST %": f["SGST%"]?.valueString ?? f["SGST%"]?.content ?? "",
        "SGST_AMOUNT": sgstAmt,
        "CGST %": f["CGST%"]?.valueString ?? f["CGST%"]?.content ?? "",
        "CGST_AMOUNT": cgstAmt,
      };

      const rowIndex = allRows.push(row) - 1;

      if (isFirstRow) {
        // remember which row is the parent row for this invoice
        groupMap.set(key, { parentRowIndex: rowIndex, rowIndexes: [rowIndex] });
      } else {
        const group = groupMap.get(key) || { parentRowIndex: null, rowIndexes: [] };
        group.rowIndexes.push(rowIndex);
        groupMap.set(key, group);
      }

      isFirstRow = false;
    });

    if (items.length > 0) {
      const group = groupMap.get(key);
      if (group && typeof group.parentRowIndex === "number") {
        const parentRow = allRows[group.parentRowIndex];
        parentRow["TOTAL IGST"] = totalIGST;
        parentRow["TOTAL SGST"] = totalSGST;
        parentRow["TOTAL CGST"] = totalCGST;
        parentRow["TOTAL GST"] = totalIGST + totalSGST + totalCGST;

        let totalAmountField = parseAmount(fields["TOTAL AMOUNT"]?.valueString ?? fields["TOTAL AMOUNT"]?.content);
        if (!totalAmountField) totalAmountField = totalTaxable + totalIGST + totalSGST + totalCGST;
        parentRow["TOTAL AMOUNT"] = totalAmountField;
      }
    } else {
      const rowIndex = allRows.push(baseParent) - 1;
      groupMap.set(key, { parentRowIndex: rowIndex, rowIndexes: [rowIndex] });
    }
  });

  // 2) Insert into SQL Server and capture identity per invoice; write it back into Excel rows
  await writeToSqlAndFillIds(dataArray, allRows, groupMap);

  // 3) Write Excel (now INVOICE ID is populated from DB)
  const ALL_COLUMNS = [...PARENT_COLUMNS, ...CHILD_COLUMNS];
  const orderedData = allRows.map(row => Object.fromEntries(ALL_COLUMNS.map(col => [col, row[col] ?? ""])));

  let workbook;
  if (fs.existsSync(extractedExcelFile)) {
    workbook = XLSX.readFile(extractedExcelFile);
    if (workbook.Sheets["Invoices"]) delete workbook.Sheets["Invoices"];
    const i = workbook.SheetNames.indexOf("Invoices");
    if (i !== -1) workbook.SheetNames.splice(i, 1);
  } else {
    workbook = XLSX.utils.book_new();
  }

  const worksheet = XLSX.utils.json_to_sheet(orderedData, { header: ALL_COLUMNS });
  XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");
  XLSX.writeFile(workbook, extractedExcelFile);

  return { ok: true, rowsWritten: orderedData.length };
}

// ============== DB write helper ==============
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

      // Check existing parent
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
        ins.input("total_igst",          sql.Decimal(15,2), parseAmount(f["TOTAL IGST"]?.valueString ?? f["TOTAL IGST"]?.content));
        ins.input("total_sgst",          sql.Decimal(15,2), parseAmount(f["TOTAL SGST"]?.valueString ?? f["TOTAL SGST"]?.content));
        ins.input("total_cgst",          sql.Decimal(15,2), parseAmount(f["TOTAL CGST"]?.valueString ?? f["TOTAL CGST"]?.content));
        ins.input("total_gst",           sql.Decimal(15,2), parseAmount(f["TOTAL GST"] ?.valueString ?? f["TOTAL GST"] ?.content));
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

      // Put the DB invoiceId back into the Excel rows for this invoice (parent row + all child rows)
      for (const idx of group.rowIndexes) {
        allRows[idx]["INVOICE ID"] = invoiceId;
      }

      // Reset child rows for this invoice and insert fresh
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
        insChild.input("charges_description", sql.VarChar(255), o["CHARGE_DESCRIPTION"]?.content ?? null);
        insChild.input("hsn_sac",             sql.VarChar(50),  o["HSN_SAC_CODE"]?.content ?? null);
        insChild.input("tax",                 sql.VarChar(20),  o["TAX"]?.content ?? null);
        insChild.input("based_on",            sql.VarChar(50),  o["BASED ON"]?.content ?? null);
        insChild.input("rate",                sql.Decimal(15,2), parseAmount(o["RATE"]?.valueString ?? o["RATE"]?.content));
        insChild.input("currency",            sql.VarChar(10),  o["CURRENCY"]?.content ?? null);
        insChild.input("taxable_amount",      sql.Decimal(15,2), parseAmount(o["TAXABLE AMOUNT"]?.valueString ?? o["TAXABLE AMOUNT"]?.content));
        insChild.input("igst_percent",        sql.VarChar(10),  o["IGST %"]?.valueString ?? o["IGST %"]?.content ?? null);
        insChild.input("igst_amount",         sql.Decimal(15,2), parseAmount(o["IGST_AMOUNT"]?.valueString ?? o["IGST_AMOUNT"]?.content));
        insChild.input("sgst_percent",        sql.VarChar(10),  o["SGST%"]?.valueString ?? o["SGST%"]?.content ?? null);
        insChild.input("sgst_amount",         sql.Decimal(15,2), parseAmount(o["SGST_AMOUNT"]?.valueString ?? o["SGST_AMOUNT"]?.content));
        insChild.input("cgst_percent",        sql.VarChar(10),  o["CGST%"]?.valueString ?? o["CGST%"]?.content ?? null);
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

module.exports = { saveToExcel };




// const fs = require("fs");
// const XLSX = require("xlsx");
// const { extractedExcelFile } = require("../config/constants");

// const PARENT_COLUMNS = [
//   "INVOICE ID", "FILENAME", "DOCUMENT CONFIDENCE", "SUPPLIER NAME", "INVOICE NUMBER", "INVOICE DATE",
//   "SUPPLIER GST", "SUPPLIER ADDRESS", "BL NUMBER",
//   "TOTAL IGST", "TOTAL SGST", "TOTAL CGST", "TOTAL GST",
//   "TOTAL AMOUNT", "CUSTOMER GST", "CUSTOMER NAME", "CUSTOMER ADDRESS"
// ];

// const CHILD_COLUMNS = [
//   "SIZE", "TYPE", "CHARGES DESCRIPTION", "HSN/SAC", "TAX", "BASED ON",
//   "RATE", "CURRENCY", "TAXABLE AMOUNT",
//   "IGST %", "IGST_AMOUNT", "SGST %", "SGST_AMOUNT", "CGST %", "CGST_AMOUNT"
// ];

// function parseAmount(val) {
//   if (!val) return 0;
//   if (typeof val === "number") return val;
//   if (typeof val === "string") {
//     return parseFloat(val.replace(/,/g, "").replace(/[^\d.-]/g, "")) || 0;
//   }
//   return 0;
// }

// function cleanText(value) {
//   return (value || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
// }

// function saveToExcel(dataArray) {
//   const allRows = [];
//   let invoiceCounter = 1;

//   dataArray.forEach(item => {
//     const doc = item.full_json?.documents?.[0] || {};
//     const fields = doc.fields || {};
//     const confidence = doc?.confidence || "";

//     // Parent Base
//     const baseParent = {
//       "INVOICE ID": `INV${invoiceCounter.toString().padStart(3, "0")}`,
//       "FILENAME": item.file || "",
//       "DOCUMENT CONFIDENCE": confidence,
//       "SUPPLIER NAME": cleanText(fields["SUPPLIER NAME"]?.content),
//       "INVOICE NUMBER": fields["INVOICE NUMBER"]?.content || "",
//       "INVOICE DATE": fields["INVOICE DATE"]?.content || "",
//       "SUPPLIER GST": fields["SUPPLIER GST"]?.content || "",
//       "SUPPLIER ADDRESS": cleanText(fields["SUPPLIER ADDRESS"]?.content),
//       "BL NUMBER": fields["BL NUMBER"]?.content || "",
//       "TOTAL IGST": 0,
//       "TOTAL SGST": 0,
//       "TOTAL CGST": 0,
//       "TOTAL GST": 0,
//       "TOTAL AMOUNT": 0,
//       "CUSTOMER GST": fields["CUSTOMER GST"]?.content || "",
//       "CUSTOMER NAME": cleanText(fields["CUSTOMER NAME"]?.content),
//       "CUSTOMER ADDRESS": cleanText(fields["CUSTOMER ADDRESS"]?.content)
//     };

//     // Child Table - LineItems
//     const items = fields["LineItems"]?.valueArray || [];
//     let totalIGST = 0, totalSGST = 0, totalCGST = 0, totalTaxable = 0;

//     if (items.length > 0) {
//       let isFirstRow = true;

//       items.forEach(line => {
//         const f = line.valueObject || {};

//         const igstAmt = parseAmount(f["IGST_AMOUNT"]?.valueString ?? f["IGST_AMOUNT"]?.content);
//         const sgstAmt = parseAmount(f["SGST_AMOUNT"]?.valueString ?? f["SGST_AMOUNT"]?.content);
//         const cgstAmt = parseAmount(f["CGST_AMOUNT"]?.valueString ?? f["CGST_AMOUNT"]?.content);
//         const taxable = parseAmount(f["TAXABLE AMOUNT"]?.valueString ?? f["TAXABLE AMOUNT"]?.content);

//         totalIGST += igstAmt;
//         totalSGST += sgstAmt;
//         totalCGST += cgstAmt;
//         totalTaxable += taxable;

//         const row = {
//           ...(isFirstRow ? baseParent : Object.fromEntries(PARENT_COLUMNS.map(col => [col, ""]))),
//           "SIZE": f["SIZE"]?.content || "",
//           "TYPE": f["TYPE"]?.content || "",
//           "CHARGES DESCRIPTION": f["CHARGE_DESCRIPTION"]?.content || "",
//            "HSN/SAC": f["HSN_SAC_CODE"]?.content || "",
//           "TAX": f["TAX"]?.content || "",
//           "BASED ON": f["BASED ON"]?.content || "",
//           "RATE": f["RATE"]?.valueString ?? f["RATE"]?.content ?? "",
//           "CURRENCY": f["CURRENCY"]?.content || "",
//           "TAXABLE AMOUNT": taxable,
//           "IGST %": f["IGST%"]?.valueString ?? f["IGST%"]?.content ?? "",
//           "IGST_AMOUNT": igstAmt,
//           "SGST %": f["SGST%"]?.valueString ?? f["SGST%"]?.content ?? "",
//           "SGST_AMOUNT": sgstAmt,
//           "CGST %": f["CGST%"]?.valueString ?? f["CGST%"]?.content ?? "",
//           "CGST_AMOUNT": cgstAmt
//         };

//         allRows.push(row);
//         isFirstRow = false;
//       });

//       // Update totals in parent row
//       allRows.find(r => r["INVOICE ID"] === baseParent["INVOICE ID"])["TOTAL IGST"] = totalIGST;
//       allRows.find(r => r["INVOICE ID"] === baseParent["INVOICE ID"])["TOTAL SGST"] = totalSGST;
//       allRows.find(r => r["INVOICE ID"] === baseParent["INVOICE ID"])["TOTAL CGST"] = totalCGST;
//       allRows.find(r => r["INVOICE ID"] === baseParent["INVOICE ID"])["TOTAL GST"] = totalIGST + totalSGST + totalCGST;

//       // If TOTAL AMOUNT not extracted, calculate from taxable + GST
//       let totalAmountField = parseAmount(fields["TOTAL AMOUNT"]?.valueString ?? fields["TOTAL AMOUNT"]?.content);
//       if (!totalAmountField) {
//         totalAmountField = totalTaxable + totalIGST + totalSGST + totalCGST;
//       }
//       allRows.find(r => r["INVOICE ID"] === baseParent["INVOICE ID"])["TOTAL AMOUNT"] = totalAmountField;

//     } else {
//       // No child table - push only parent
//       allRows.push(baseParent);
//     }

//     invoiceCounter++;
//   });

//   // Combine Parent + Child headers for Excel
//   const ALL_COLUMNS = [...PARENT_COLUMNS, ...CHILD_COLUMNS];

//   const orderedData = allRows.map(row =>
//     Object.fromEntries(ALL_COLUMNS.map(col => [col, row[col] ?? ""]))
//   );

//   let workbook;
//   if (fs.existsSync(extractedExcelFile)) {
//     workbook = XLSX.readFile(extractedExcelFile);
//     if (workbook.Sheets["Invoices"]) delete workbook.Sheets["Invoices"];
//     const i = workbook.SheetNames.indexOf("Invoices");
//     if (i !== -1) workbook.SheetNames.splice(i, 1);
//   } else {
//     workbook = XLSX.utils.book_new();
//   }

//   const worksheet = XLSX.utils.json_to_sheet(orderedData, { header: ALL_COLUMNS });
//   XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");
//   XLSX.writeFile(workbook, extractedExcelFile);
// }

// module.exports = { saveToExcel };
