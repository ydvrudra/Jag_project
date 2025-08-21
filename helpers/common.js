// helpers/common.js
const { extractedExcelFile } = require("../config/constants");

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
  if (val === 0) return 0;
  if (!val) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val.replace(/,/g, "").replace(/[^\d.-]/g, ""));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function parsePercent(val) {
  if (val === 0) return 0;
  if (!val) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    // handles "9", "9.0", "9%", " 9 % "
    const n = parseFloat(val.replace("%", "").trim());
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function cleanText(value) {
  return (value || "").replace(/\n/g, ", ").replace(/\s+/g, " ").trim();
}

function getFirst(o, keys) {
  for (const k of keys) {
    const v = o?.[k];
    if (!v) continue;
    const c = v.valueString ?? v.content ?? v;
    if (c !== undefined && c !== null && String(c).trim() !== "") return c;
  }
  return undefined;
}

function invoiceKey(file, invNo, suppGst) {
  return [file || "", invNo || "", suppGst || ""].join("|").toLowerCase();
}

module.exports = {
  extractedExcelFile,
  PARENT_COLUMNS,
  CHILD_COLUMNS,
  parseAmount,
  parsePercent,
  cleanText,
  getFirst,
  invoiceKey,
};
