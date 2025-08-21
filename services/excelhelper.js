// CORRECT: destructure from the exported object
const { saveToExcelAndDb } = require("./exporter");

module.exports = { saveToExcel: saveToExcelAndDb };
