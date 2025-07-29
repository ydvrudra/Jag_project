const fs = require("fs");
const XLSX = require("xlsx");
const { extractedExcelFile } = require("../config/constants");

function saveToExcel(dataArray) {
  const flatData = dataArray.map((item) => {
    const doc = item.full_json?.documents?.[0]?.fields || {};
    const flatObj = { File: item.file };

    for (const [key, val] of Object.entries(doc)) {
      flatObj[key] = val?.value || val?.content || "";
    }

    return flatObj;
  });

  let workbook;
  let worksheet;

  if (fs.existsSync(extractedExcelFile)) {
    workbook = XLSX.readFile(extractedExcelFile);
    worksheet = workbook.Sheets["Invoices"];
    const existingData = XLSX.utils.sheet_to_json(worksheet);
    worksheet = XLSX.utils.json_to_sheet([...existingData, ...flatData]);
  } else {
    workbook = XLSX.utils.book_new();
    worksheet = XLSX.utils.json_to_sheet(flatData);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");
  }

  workbook.Sheets["Invoices"] = worksheet;
  XLSX.writeFile(workbook, extractedExcelFile);
}

module.exports = { saveToExcel };
