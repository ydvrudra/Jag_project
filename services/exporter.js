const { PARENT_COLUMNS, CHILD_COLUMNS, parseAmount, cleanText, invoiceKey } = require("../helpers/common");
const { detectVendor } = require("../vendors/detect");
const hapag = require("../vendors/hapag");
const cma = require("../vendors/cma");
const maersk = require("../vendors/maersk");
const msc = require("../vendors/msc");

// IMPORT NEW FUNCTION (not old one)
const { writeToMainTables } = require("../repositories/invoiceRepository");
const { writeExcel } = require("./excelWriter");

const VENDOR_MAPPERS = {
  hapag: hapag.mapLineItem,
  cma: cma.mapLineItem,
  maersk: maersk.mapLineItem,
  msc: msc.mapLineItem,
  generic: cma.mapLineItem,
};

// ==============================================
// MAIN FUNCTION: Save to Excel AND Main Tables
// ==============================================
async function saveToExcelAndMainTables(dataArray) {
  console.log(`📊 Starting export for ${dataArray.length} invoice(s)`);
  
  const allRows = [];
  const groupMap = new Map(); // key -> { parentRowIndex, rowIndexes[] }

  // ====================================
  // STEP 1: PROCESS EACH INVOICE
  // ====================================
  dataArray.forEach((item, itemIndex) => {
    const doc = item.full_json?.documents?.[0] || {};
    const fields = doc.fields || {};
    const confidence = doc?.confidence || "";

    const vendor = detectVendor(fields);
    const mapLineItem = VENDOR_MAPPERS[vendor] || VENDOR_MAPPERS.generic;

    const file = item.file || "";
    const invNo = fields["INVOICE NUMBER"]?.content || "";
    const suppGst = fields["SUPPLIER GST"]?.content || "";
    const key = invoiceKey(file, invNo, suppGst);

    console.log(`🔧 Processing invoice ${itemIndex + 1}: ${file} (Vendor: ${vendor})`);

    // Base parent row (first row of each invoice)
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

    console.log(`   Found ${items.length} line item(s)`);

    // ====================================
    // STEP 2: PROCESS LINE ITEMS
    // ====================================
    items.forEach((line, lineIndex) => {
      const rowChild = mapLineItem(line);

      // Accumulate totals
      totalIGST += Number(rowChild["IGST_AMOUNT"] || 0);
      totalSGST += Number(rowChild["SGST_AMOUNT"] || 0);
      totalCGST += Number(rowChild["CGST_AMOUNT"] || 0);
      totalTaxable += Number(rowChild["TAXABLE_AMOUNT"] || 0);

      // Combine parent and child data
      const row = {
        ...(isFirstRow ? baseParent : Object.fromEntries(PARENT_COLUMNS.map(col => [col, ""]))),
        ...rowChild
      };

      const rowIndex = allRows.push(row) - 1;
      
      // Update group mapping
      if (isFirstRow) {
        groupMap.set(key, { parentRowIndex: rowIndex, rowIndexes: [rowIndex] });
      } else {
        const g = groupMap.get(key) || { parentRowIndex: null, rowIndexes: [] };
        g.rowIndexes.push(rowIndex);
        groupMap.set(key, g);
      }
      
      isFirstRow = false;
    });

    // ====================================
    // STEP 3: UPDATE TOTALS IN PARENT ROW
    // ====================================
    if (items.length > 0) {
      const group = groupMap.get(key);
      if (group && typeof group.parentRowIndex === "number") {
        const parentRow = allRows[group.parentRowIndex];
        parentRow["TOTAL IGST"] = +totalIGST.toFixed(2);
        parentRow["TOTAL SGST"] = +totalSGST.toFixed(2);
        parentRow["TOTAL CGST"] = +totalCGST.toFixed(2);
        parentRow["TOTAL GST"] = +(totalIGST + totalSGST + totalCGST).toFixed(2);

        // Calculate total amount
        let totalAmountField = parseAmount(fields["TOTAL AMOUNT"]?.valueString ?? fields["TOTAL AMOUNT"]?.content);
        if (!totalAmountField) {
          totalAmountField = totalTaxable + totalIGST + totalSGST + totalCGST;
        }
        parentRow["TOTAL AMOUNT"] = +totalAmountField.toFixed(2);
        
        console.log(`   Invoice totals - GST: ${parentRow["TOTAL GST"]}, Amount: ${parentRow["TOTAL AMOUNT"]}`);
      }
    } else {
      // No line items - insert just parent row
      const rowIndex = allRows.push(baseParent) - 1;
      groupMap.set(key, { parentRowIndex: rowIndex, rowIndexes: [rowIndex] });
      console.log(`   No line items found for this invoice`);
    }
  });

  console.log(`✅ Data processing complete. Total rows: ${allRows.length}`);

  // ====================================
  // STEP 4: WRITE TO MAIN DATABASE TABLES
  // ====================================
  console.log(`💾 Writing to main database tables...`);
  const dbResult = await writeToMainTables(dataArray, allRows, groupMap);
  console.log(`✅ Database write successful: ${dbResult.message}`);

  // ====================================
  // STEP 5: WRITE TO EXCEL (OPTIONAL)
  // ====================================
  console.log(`📝 Writing to Excel file...`);
  const excelResult = writeExcel(allRows);
  console.log(`✅ Excel write successful. Rows written: ${excelResult.rowsWritten}`);

  return {
    success: true,
    database: dbResult,
    excel: excelResult,
    summary: {
      totalInvoices: dataArray.length,
      totalRows: allRows.length,
      timestamp: new Date().toISOString()
    }
  };
}

// ==============================================
// EXPORT THE UPDATED FUNCTION
// ==============================================
module.exports = { saveToExcelAndDb: saveToExcelAndMainTables };