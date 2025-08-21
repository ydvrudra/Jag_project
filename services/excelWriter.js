// services/excelWriter.js
const fs = require("fs");
const XLSX = require("xlsx");
const { extractedExcelFile, PARENT_COLUMNS, CHILD_COLUMNS } = require("../helpers/common");

function writeExcel(allRows) {
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

  return { ok: true, rowsWritten: orderedData.length };
}

module.exports = { writeExcel };
