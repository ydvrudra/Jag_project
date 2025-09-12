// services/excelWriter.js
const fs = require("fs");
const XLSX = require("xlsx");
const { extractedExcelFile, PARENT_COLUMNS, CHILD_COLUMNS } = require("../helpers/common");

function writeExcel(newRows) {
  const ALL_COLUMNS = [...PARENT_COLUMNS, ...CHILD_COLUMNS];
  const newData = newRows.map(row =>
    Object.fromEntries(ALL_COLUMNS.map(col => [col, row[col] ?? ""]))
  );

  let workbook;
  let existingData = [];

  if (fs.existsSync(extractedExcelFile)) {
    workbook = XLSX.readFile(extractedExcelFile);
    const existingSheet = workbook.Sheets["Invoices"];

    if (existingSheet) {
      existingData = XLSX.utils.sheet_to_json(existingSheet);
    }
  } else {
    workbook = XLSX.utils.book_new();
  }

  // Combine old + new data
  const allData = [...existingData, ...newData];

  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(allData, { header: ALL_COLUMNS });

  // Remove old sheet if exists
  if (workbook.Sheets["Invoices"]) delete workbook.Sheets["Invoices"];
  const i = workbook.SheetNames.indexOf("Invoices");
  if (i !== -1) workbook.SheetNames.splice(i, 1);

  // Append new sheet
  XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");

  // Save file
  XLSX.writeFile(workbook, extractedExcelFile);

  return { ok: true, rowsWritten: allData.length };
}


module.exports = { writeExcel };
