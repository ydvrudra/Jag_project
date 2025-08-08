const fs = require("fs");
const XLSX = require("xlsx");
const { extractedExcelFile } = require("../config/constants");

const PARENT_COLUMNS = [
  "INVOICE ID", "FILENAME", "DOCUMENT CONFIDENCE", "SUPPLIER NAME", "INVOICE NUMBER", "INVOICE DATE",
  "SUPPLIER GST", "SUPPLIER ADDRESS", "BL NUMBER",
  "TOTAL IGST", "TOTAL SGST", "TOTAL CGST", "TOTAL GST",
  "TOTAL AMOUNT", "CUSTOMER GST", "CUSTOMER NAME", "CUSTOMER ADDRESS"
];

const CHILD_COLUMNS = [
  "SIZE", "TYPE", "CHARGES DESCRIPTION", "HSN/SAC", "TAX", "BASED ON",
  "RATE", "CURRENCY", "TAXABLE AMOUNT",
  "IGST %", "IGST_AMOUNT", "SGST %", "SGST_AMOUNT", "CGST %", "CGST_AMOUNT"
];

function parseAmount(val) {
  if (!val) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    return parseFloat(val.replace(/,/g, "").replace(/[^\d.-]/g, "")) || 0;
  }
  return 0;
}

function cleanText(value) {
  return (value || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

function saveToExcel(dataArray) {
  const allRows = [];
  let invoiceCounter = 1;

  dataArray.forEach(item => {
    const doc = item.full_json?.documents?.[0] || {};
    const fields = doc.fields || {};
    const confidence = doc?.confidence || "";

    // Parent Base
    const baseParent = {
      "INVOICE ID": `INV${invoiceCounter.toString().padStart(3, "0")}`,
      "FILENAME": item.file || "",
      "DOCUMENT CONFIDENCE": confidence,
      "SUPPLIER NAME": cleanText(fields["SUPPLIER NAME"]?.content),
      "INVOICE NUMBER": fields["INVOICE NUMBER"]?.content || "",
      "INVOICE DATE": fields["INVOICE DATE"]?.content || "",
      "SUPPLIER GST": fields["SUPPLIER GST"]?.content || "",
      "SUPPLIER ADDRESS": cleanText(fields["SUPPLIER ADDRESS"]?.content),
      "BL NUMBER": fields["BL NUMBER"]?.content || "",
      "TOTAL IGST": 0,
      "TOTAL SGST": 0,
      "TOTAL CGST": 0,
      "TOTAL GST": 0,
      "TOTAL AMOUNT": 0,
      "CUSTOMER GST": fields["CUSTOMER GST"]?.content || "",
      "CUSTOMER NAME": cleanText(fields["CUSTOMER NAME"]?.content),
      "CUSTOMER ADDRESS": cleanText(fields["CUSTOMER ADDRESS"]?.content)
    };

    // Child Table - LineItems
    const items = fields["LineItems"]?.valueArray || [];
    let totalIGST = 0, totalSGST = 0, totalCGST = 0, totalTaxable = 0;

    if (items.length > 0) {
      let isFirstRow = true;

      items.forEach(line => {
        const f = line.valueObject || {};

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
          "SIZE": f["SIZE"]?.content || "",
          "TYPE": f["TYPE"]?.content || "",
          "CHARGES DESCRIPTION": f["CHARGE_DESCRIPTION"]?.content || "",
           "HSN/SAC": f["HSN_SAC_CODE"]?.content || "",
          "TAX": f["TAX"]?.content || "",
          "BASED ON": f["BASED ON"]?.content || "",
          "RATE": f["RATE"]?.valueString ?? f["RATE"]?.content ?? "",
          "CURRENCY": f["CURRENCY"]?.content || "",
          "TAXABLE AMOUNT": taxable,
          "IGST %": f["IGST%"]?.valueString ?? f["IGST%"]?.content ?? "",
          "IGST_AMOUNT": igstAmt,
          "SGST %": f["SGST%"]?.valueString ?? f["SGST%"]?.content ?? "",
          "SGST_AMOUNT": sgstAmt,
          "CGST %": f["CGST%"]?.valueString ?? f["CGST%"]?.content ?? "",
          "CGST_AMOUNT": cgstAmt
        };

        allRows.push(row);
        isFirstRow = false;
      });

      // Update totals in parent row
      allRows.find(r => r["INVOICE ID"] === baseParent["INVOICE ID"])["TOTAL IGST"] = totalIGST;
      allRows.find(r => r["INVOICE ID"] === baseParent["INVOICE ID"])["TOTAL SGST"] = totalSGST;
      allRows.find(r => r["INVOICE ID"] === baseParent["INVOICE ID"])["TOTAL CGST"] = totalCGST;
      allRows.find(r => r["INVOICE ID"] === baseParent["INVOICE ID"])["TOTAL GST"] = totalIGST + totalSGST + totalCGST;

      // If TOTAL AMOUNT not extracted, calculate from taxable + GST
      let totalAmountField = parseAmount(fields["TOTAL AMOUNT"]?.valueString ?? fields["TOTAL AMOUNT"]?.content);
      if (!totalAmountField) {
        totalAmountField = totalTaxable + totalIGST + totalSGST + totalCGST;
      }
      allRows.find(r => r["INVOICE ID"] === baseParent["INVOICE ID"])["TOTAL AMOUNT"] = totalAmountField;

    } else {
      // No child table - push only parent
      allRows.push(baseParent);
    }

    invoiceCounter++;
  });

  // Combine Parent + Child headers for Excel
  const ALL_COLUMNS = [...PARENT_COLUMNS, ...CHILD_COLUMNS];

  const orderedData = allRows.map(row =>
    Object.fromEntries(ALL_COLUMNS.map(col => [col, row[col] ?? ""]))
  );

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
}

module.exports = { saveToExcel };
