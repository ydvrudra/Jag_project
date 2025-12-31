//repositories/invoiceRepository
const { sql, poolConnect } = require("../config/sqlConfig");
const { parseAmount, cleanText, invoiceKey } = require("../helpers/common");

// Helper: Convert to formatted string number
function toStringNumber(value) {
  const num = parseAmount(value);
  return (typeof num === "number" && !isNaN(num)) ? num.toFixed(2) : "0.00";
}

// Helper: Get content from field object or backup row
function getContent(fieldObj, rowBackup, colName) {
  let val = fieldObj?.valueString ?? fieldObj?.content ?? rowBackup?.[colName] ?? null;
  if (val === null) return null;
  if (typeof val === "object") return null;
  return val.toString().trim();
}

function normalizeCurrency(val) {
  if (!val) return "";
  const asString = val.toString().replace(/\s+/g, " ").trim();
  if (!asString) return "";
  const token = asString.split(" ")[0]; 
  return token.substring(0, 10); 
}

function cleanPercentValue(value) {
  if (!value) return "0";
  
  const str = value.toString();
  const clean = str
    .replace(/[\r\n]+/g, ' ')      
    .replace(/\s+/g, ' ')          
    .trim();
    
  const numMatch = clean.match(/\d+(\.\d+)?/);
  return numMatch ? numMatch[0] : "0";
}

async function writeToMainTables(dataArray, allRows, groupMap,recordId) {
  console.log("🔍 DEBUG - RecordId received:", recordId);
  console.log("🔍 DEBUG - Is recordId valid?", recordId > 0);
  const pool = await poolConnect;
  const tx = new sql.Transaction(pool);
  
  await tx.begin();

  try {
   // console.log(`💾 Starting database write for ${dataArray.length} invoices`);
    
    for (const item of dataArray) {
      const doc = item.full_json?.documents?.[0] || {};
      const f = doc.fields || {};
      const file = item.file || "";
      const invNo = f["INVOICE NUMBER"]?.content || "";
      const suppGst = f["SUPPLIER GST"]?.content || "";
      const key = invoiceKey(file, invNo, suppGst);
      const group = groupMap.get(key);
      
      if (!group) {
        //console.warn(`⚠️ No group found for key: ${key}`);
        continue;
      }

      // Calculate totals from allRows
      let totalIGST = 0, totalSGST = 0, totalCGST = 0;
      group.rowIndexes.forEach(idx => {
        totalIGST += Number(allRows[idx]["IGST_AMOUNT"] || 0);
        totalSGST += Number(allRows[idx]["SGST_AMOUNT"] || 0);
        totalCGST += Number(allRows[idx]["CGST_AMOUNT"] || 0);
      });
      const totalGST = totalIGST + totalSGST + totalCGST;

      const insertInvoice = new sql.Request(tx);
      
      // Set all input parameters
      insertInvoice.input("upload_header_id", sql.Int, recordId || null);
      insertInvoice.input("filename", sql.VarChar(255), file || null);
      insertInvoice.input("document_confidence", sql.Decimal(6, 3), doc.confidence ?? null);
      insertInvoice.input("supplier_name", sql.VarChar(255), cleanText(f["SUPPLIER NAME"]?.content));
      insertInvoice.input("invoice_number", sql.VarChar(100), invNo || null);
      insertInvoice.input("invoice_date", sql.VarChar(50), f["INVOICE DATE"]?.content || null);
      insertInvoice.input("supplier_gst", sql.VarChar(32), suppGst || null);
      insertInvoice.input("supplier_address", sql.NVarChar(sql.MAX), cleanText(f["SUPPLIER ADDRESS"]?.content));
      insertInvoice.input("bl_number", sql.VarChar(100), f["BL NUMBER"]?.content || null);
      insertInvoice.input("total_igst", sql.VarChar(50), totalIGST.toFixed(2));
      insertInvoice.input("total_sgst", sql.VarChar(50), totalSGST.toFixed(2));
      insertInvoice.input("total_cgst", sql.VarChar(50), totalCGST.toFixed(2));
      insertInvoice.input("total_gst", sql.VarChar(50), totalGST.toFixed(2));
      insertInvoice.input("total_amount", sql.VarChar(50), toStringNumber(f["TOTAL AMOUNT"]?.valueString ?? f["TOTAL AMOUNT"]?.content));
      insertInvoice.input("customer_gst", sql.VarChar(32), f["CUSTOMER GST"]?.content ?? null);
      insertInvoice.input("customer_name", sql.VarChar(255), cleanText(f["CUSTOMER NAME"]?.content));
      insertInvoice.input("customer_address", sql.NVarChar(sql.MAX), cleanText(f["CUSTOMER ADDRESS"]?.content));
      
      // Additional fields for main table (as per your table structure)
      insertInvoice.input("kz_PageMasterId", sql.Int, 452); // Example - adjust as needed
      insertInvoice.input("kz_UserId", sql.Int, 3); // Example - adjust as needed
      insertInvoice.input("kz_CompanyId", sql.Int, 1);
      insertInvoice.input("kz_LocationId", sql.Int, 1);
      insertInvoice.input("kz_CreatedUserId", sql.Int, 3);
      insertInvoice.input("kz_ModifiedUserId", sql.Int, null);
      insertInvoice.input("kz_ModifiedCompanyId", sql.Int, 1);
      insertInvoice.input("kz_ModifiedLocationId", sql.Int, 1);
      insertInvoice.input("kz_IPAddress", sql.VarChar(50), "127.0.0.1");
      insertInvoice.input("kz_SessionId", sql.VarChar(255), "nodejs-session");
      insertInvoice.input("kz_PcName", sql.VarChar(255), "NODEJS-SERVER");
      insertInvoice.input("kz_CreatedDateTime", sql.DateTime, new Date());
      insertInvoice.input("kz_ModifiedDateTime", sql.DateTime, null);

      // Execute insert into invoicesmain
      const invoiceResult = await insertInvoice.query(`
        INSERT INTO dbo.invoicesmain (
          filename, document_confidence, supplier_name, invoice_number, invoice_date,
          supplier_gst, supplier_address, bl_number, total_igst, total_sgst, total_cgst,
          total_gst, total_amount, customer_gst, customer_name, customer_address,
          created_datetime, kz_PageMasterId, kz_UserId, kz_CompanyId,
          kz_LocationId, kz_CreatedUserId, kz_ModifiedUserId,
          kz_ModifiedCompanyId, kz_ModifiedLocationId, kz_IPAddress,
          kz_SessionId, kz_PcName, kz_CreatedDateTime, kz_ModifiedDateTime,
          UploadHeaderId  
        )
        VALUES (
          @filename, @document_confidence, @supplier_name, @invoice_number, @invoice_date,
          @supplier_gst, @supplier_address, @bl_number, @total_igst, @total_sgst, @total_cgst,
          @total_gst, @total_amount, @customer_gst, @customer_name, @customer_address,
          GETDATE(), @kz_PageMasterId, @kz_UserId, @kz_CompanyId,
          @kz_LocationId, @kz_CreatedUserId, @kz_ModifiedUserId,
          @kz_ModifiedCompanyId, @kz_ModifiedLocationId, @kz_IPAddress,
          @kz_SessionId, @kz_PcName, @kz_CreatedDateTime, @kz_ModifiedDateTime,
           @upload_header_id
        );
        
        SELECT SCOPE_IDENTITY() AS invoice_main_id;
      `);
      
      const invoiceMainId = invoiceResult.recordset[0].invoice_main_id;
     // console.log(`✅ Inserted into invoicesmain, ID: ${invoiceMainId}`);
      
      // Attach invoice ID to rows for reference
      group.rowIndexes.forEach(idx => {
        allRows[idx]["INVOICE ID"] = invoiceMainId;
      });

      const items = f["LineItems"]?.valueArray || [];
      
      for (let i = 0; i < items.length; i++) {
        const line = items[i];
        const o = line.valueObject || {};
        const idx = group.rowIndexes[i];
        const rowBackup = allRows[idx] || {};

        const lineItemPayload = {
          invoice_main_id: invoiceMainId,
          size: getContent(o["SIZE"], rowBackup, "SIZE"),
          type: getContent(o["TYPE"], rowBackup, "TYPE"),
          charges_description: getContent(o["CHARGE_DESCRIPTION"], rowBackup, "CHARGE_DESCRIPTION"),
          hsn_sac: getContent(o["HSN_SAC_CODE"], rowBackup, "HSN_SAC_CODE") || getContent(o["HSN/SAC"], rowBackup, "HSN/SAC"),
          tax: getContent(o["TAX"], rowBackup, "TAX"),
          based_on: getContent(o["BASED ON"], rowBackup, "BASED ON"),
          rate: toStringNumber(getContent(o["RATE"], rowBackup, "RATE")),
          currency: normalizeCurrency(getContent(o["CURRENCY"], rowBackup, "CURRENCY")),
          taxable_amount: toStringNumber(
            getContent(o["TAXABLE_AMOUNT"], rowBackup, "TAXABLE_AMOUNT") ||
            getContent(o["TAXABLE AMOUNT"], rowBackup, "TAXABLE AMOUNT") ||
            getContent(o["AMOUNT"], rowBackup, "AMOUNT")
          ),
           igst_percent: cleanPercentValue(getContent(o["IGST%"], rowBackup, "IGST%")),
          igst_amount: toStringNumber(getContent(o["IGST_AMOUNT"], rowBackup, "IGST_AMOUNT")),
         sgst_percent: cleanPercentValue(getContent(o["SGST%"], rowBackup, "SGST%")),
          sgst_amount: toStringNumber(getContent(o["SGST_AMOUNT"], rowBackup, "SGST_AMOUNT")),
          cgst_percent: cleanPercentValue(getContent(o["CGST%"], rowBackup, "CGST%")),
          cgst_amount: toStringNumber(getContent(o["CGST_AMOUNT"], rowBackup, "CGST_AMOUNT")),
        };

        const insertLineItem = new sql.Request(tx);
        
        // Set all parameters
        Object.keys(lineItemPayload).forEach(key => {
          const value = lineItemPayload[key];
          if (key === "invoice_main_id") {
            insertLineItem.input(key, sql.Int, value);
          } else {
            insertLineItem.input(key, sql.VarChar(sql.MAX), value || "");
          }
        });
        
        // Additional fields for main table
        insertLineItem.input("invoicesId", sql.Int, 0); // Adjust as needed
        insertLineItem.input("invoice_id", sql.Int, invoiceMainId);       
        insertLineItem.input("invoicesmainId", sql.Int, invoiceMainId);
        insertLineItem.input("kz_UserId", sql.Int, 3);
        insertLineItem.input("kz_CompanyId", sql.Int, 1);
        insertLineItem.input("kz_PageMasterId", sql.Int, 452);
        insertLineItem.input("kz_LocationId", sql.Int, 1);
        insertLineItem.input("Temp_EntryType", sql.Int, 1);
        insertLineItem.input("kz_ModifiedUserId", sql.Int, null);
        insertLineItem.input("kz_ModifiedCompanyId", sql.Int, 1);
        insertLineItem.input("kz_ModifiedLocationId", sql.Int, 1);
        insertLineItem.input("kz_CreatedUserId", sql.Int, 3);
        insertLineItem.input("kz_ModifiedDateTime", sql.DateTime, null);
        insertLineItem.input("lineitems_id", sql.Int, 0); // Adjust as needed

        await insertLineItem.query(`
          INSERT INTO dbo.invoicelineitemsmain (
            invoicemain_id, invoice_id,invoicesmainId,  size, type, charges_description, hsn_sac, tax,
            based_on, rate, currency, taxable_amount,
            igst_percent, igst_amount, sgst_percent, sgst_amount,
            cgst_percent, cgst_amount,
            invoicesId, kz_UserId, kz_CompanyId, kz_PageMasterId,
            kz_LocationId, Temp_EntryType, kz_ModifiedUserId,
            kz_ModifiedCompanyId, kz_ModifiedLocationId,
            kz_CreatedUserId, kz_ModifiedDateTime,
            lineitems_id
          )
          VALUES (
            @invoice_main_id,  @invoice_main_id, @invoice_main_id, @size, @type, @charges_description, @hsn_sac, @tax,
            @based_on, @rate, @currency, @taxable_amount,
            @igst_percent, @igst_amount, @sgst_percent, @sgst_amount,
            @cgst_percent, @cgst_amount,
            @invoicesId, @kz_UserId, @kz_CompanyId, @kz_PageMasterId,
            @kz_LocationId, @Temp_EntryType, @kz_ModifiedUserId,
            @kz_ModifiedCompanyId, @kz_ModifiedLocationId,
            @kz_CreatedUserId, @kz_ModifiedDateTime,
            @lineitems_id
          );
        `);
      }
      
      //console.log(`✅ Inserted ${items.length} line items for invoice ID: ${invoiceMainId}`);
    }

    await tx.commit();
   // console.log("✅ Transaction committed successfully");
    
    return { success: true, message: `Inserted ${dataArray.length} invoices into main tables` };
    
  } catch (err) {
    console.error("❌ Error in writeToMainTables:", err);
    await tx.rollback();
    throw err;
  }
}
module.exports = { writeToMainTables };