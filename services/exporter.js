// services/exporter.js
const { PARENT_COLUMNS, CHILD_COLUMNS, parseAmount, cleanText, invoiceKey } = require("../helpers/common");
const { detectVendor } = require("../vendors/detect");
const hapag = require("../vendors/hapag");
const cma   = require("../vendors/cma");
const maersk= require("../vendors/maersk");
const msc   = require("../vendors/msc");

const { writeToMainTables  } = require("../repositories/invoiceRepository");
const { writeExcel } = require("./excelWriter");

const VENDOR_MAPPERS = {
  hapag: hapag.mapLineItem,
  cma: cma.mapLineItem,
  maersk: maersk.mapLineItem,
  msc: msc.mapLineItem,
  generic: cma.mapLineItem, // generic fallback (percent/amount style)
};

async function saveToExcelAndDb(dataArray) {
  const allRows = [];
  const groupMap = new Map(); // key -> { parentRowIndex, rowIndexes[] }

  dataArray.forEach((item) => {
    const doc = item.full_json?.documents?.[0] || {};
    const fields = doc.fields || {};
    const confidence = doc?.confidence || "";

    const vendor = detectVendor(fields);
    const mapLineItem = VENDOR_MAPPERS[vendor] || VENDOR_MAPPERS.generic;

    const file = item.file || "";
    const invNo = fields["INVOICE NUMBER"]?.content || "";
    const suppGst = fields["SUPPLIER GST"]?.content || "";
    const key = invoiceKey(file, invNo, suppGst);

    const baseParent = {
      "INVOICE ID": "",
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
      const rowChild = mapLineItem(line);

      totalIGST += Number(rowChild["IGST_AMOUNT"] || 0);
      totalSGST += Number(rowChild["SGST_AMOUNT"] || 0);
      totalCGST += Number(rowChild["CGST_AMOUNT"] || 0);
      totalTaxable += Number(rowChild["TAXABLE_AMOUNT"] || 0);

      const row = {
        ...(isFirstRow ? baseParent : Object.fromEntries(PARENT_COLUMNS.map(col => [col, ""]))),
        ...rowChild
      };

      const rowIndex = allRows.push(row) - 1;
      if (isFirstRow) {
        groupMap.set(key, { parentRowIndex: rowIndex, rowIndexes: [rowIndex] });
      } else {
        const g = groupMap.get(key) || { parentRowIndex: null, rowIndexes: [] };
        g.rowIndexes.push(rowIndex);
        groupMap.set(key, g);
      }
      isFirstRow = false;
    });

    if (items.length > 0) {
      const group = groupMap.get(key);
      if (group && typeof group.parentRowIndex === "number") {
        const parentRow = allRows[group.parentRowIndex];
        parentRow["TOTAL IGST"] = +totalIGST.toFixed(2);
        parentRow["TOTAL SGST"] = +totalSGST.toFixed(2);
        parentRow["TOTAL CGST"] = +totalCGST.toFixed(2);
        parentRow["TOTAL GST"]  = +(totalIGST + totalSGST + totalCGST).toFixed(2);

        let totalAmountField = parseAmount(fields["TOTAL AMOUNT"]?.valueString ?? fields["TOTAL AMOUNT"]?.content);
        if (!totalAmountField) totalAmountField = totalTaxable + totalIGST + totalSGST + totalCGST;
        parentRow["TOTAL AMOUNT"] = +totalAmountField.toFixed(2);
      }
    } else {
      const rowIndex = allRows.push(baseParent) - 1;
      groupMap.set(key, { parentRowIndex: rowIndex, rowIndexes: [rowIndex] });
    }
  });

  // DB write (fills INVOICE ID back into rows)
  await writeToMainTables (dataArray, allRows, groupMap);

  return writeExcel(allRows);
}

module.exports = { saveToExcelAndDb };