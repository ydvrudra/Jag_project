//controller/invoiceController
const { pool, poolConnect, sql } = require('../config/sqlConfig');
const fs = require("fs");
const { extractedExcelFile } = require("../config/constants");
const { getInvoiceFilesFromDb } = require("../services/databaseFileService");
const { processInvoice } = require("../services/invoiceProcessor");
const { sendInvoiceProcessingSummaryEmail } = require("../services/emailService");

exports.processAllInvoices = async (req, res) => {
  
  try {
    // 1. Get files from database via FTP
    //console.log("\n1️⃣  Fetching files from database...");
    const result = await getInvoiceFilesFromDb();
    const filesToProcess = result.filesToProcess || [];
    const skippedFiles = result.skippedFiles || [];

   if (filesToProcess.length === 0 && skippedFiles.length === 0) {
     // console.log('📭 No files found to process');
      return res.json({ status: "no_files", message: "No invoice files found." });
    }
      
    // 2. Process each file
    const results = [];
    const errors = [];
    const successFiles = [];
    const failFiles = [];
    
    
    for (const [index, fileData] of filesToProcess.entries()) {
      //console.log(`\n--- Processing ${index + 1}/${filesToProcess.length} ---`);
      
try {
  const processResult = await processInvoice(fileData.filePath, fileData.ftpFilename);
  
  // ✅ FIX: Check if processResult exists
  if (processResult && processResult.success === true) {
    const fileName = processResult.fileName || fileData.ftpFilename || fileData.dbFilename || 'Unknown';
    results.push({ 
      fileName: fileName, 
      status: "success",
      fileSize: fileData.fileSize,
      dbInserted: processResult.dbInserted || false,
      ftpDeleted: processResult.ftpDeleted || false
    });
    successFiles.push(fileName);
    //console.log(`✅ Success: ${fileName}`);
  } else {
    const errorMsg = processResult?.error || "Processing failed";
    throw new Error(errorMsg);
  }
} catch (err) {
  const fileName = fileData.ftpFilename || fileData.dbFilename || 'Unknown';
  //console.error(`❌ Failed: ${fileName}`, err.message);
  errors.push({ 
    fileName: fileName, 
    error: err.message 
  });
  failFiles.push(fileName);
}
    }
    
    // 3. Send summary email (with better error handling)
//console.log("\n3️⃣  Sending summary email...");
const userEmail = req.headers["email"] || process.env.DEFAULT_EMAIL;

// Only send email if we have any results
if (userEmail) {
      try {
        const emailResult = await sendInvoiceProcessingSummaryEmail({
          successCount: results.length,
          failCount: errors.length,
          successFiles: results.map(r => r.fileName),
          failFiles: errors,
          skippedFiles: skippedFiles, // 🟢 NAYA: Skip wali files pass karo
          attachmentPath: extractedExcelFile,
          toEmail: userEmail,
        });
    
    console.log("📧 Summary email sent successfully");
  } catch (emailErr) {
    console.error("❌ Email send failed:", emailErr.message);
  }
} else {
  console.log("📭 No results to email or no email address provided");
}
    
    // 4. Return response
    // console.log("\n" + "=".repeat(50));
    // console.log("📊 PROCESSING COMPLETE");
    // console.log(`✅ Successful: ${results.length}`);
    // console.log(`❌ Failed: ${errors.length}`);
    // console.log("=".repeat(50));
    
    res.json({
      status: "completed",
      processed: results.length,
      failed: errors.length,
      totalFiles: filesToProcess.length,
      details: { 
        success: results, 
        errors: errors 
      },
    });
    
  } catch (err) {
    //console.error("\n💥 MAIN PROCESSING ERROR:", err.message);
    res.status(500).json({ 
      error: "Processing failed", 
      details: err.message 
    });
  }
};

exports.downloadExcelFile = (req, res) => {
  if (!fs.existsSync(extractedExcelFile)) {
    return res.status(404).json({ error: "Excel file not found." });
  }

  res.download(extractedExcelFile, "Invoices.xlsx", (err) => {
    if (err) {
     // console.error(" Excel download error:", err.message);
      res.status(500).json({ error: "Download failed." });
    }
  });
};


exports.fetchExchangeRates = async (req, res) => {
  try {
    await poolConnect;

    const limit = parseInt(req.query.limit) || 999;
    const response = await axios.get("https://api.exchangerate-api.com/v4/latest/USD");
    const { base, rates } = response.data;

    const limitedRates = Object.entries(rates).slice(0, limit);

    for (let [toCurrency, rate] of limitedRates) {
      // // USD to Other
      // await pool.request()
      //   .input('FromCurrency', sql.VarChar(3), base)
      //   .input('ToCurrency', sql.VarChar(3), toCurrency)
      //   .input('Rate', sql.Float, rate)
      //   .query(`
      //     INSERT INTO ExchangeRates (FromCurrency, ToCurrency, Rate, UpdatedAt)
      //     VALUES (@FromCurrency, @ToCurrency, @Rate, GETDATE())
      //   `);

      // Other to USD
      if (rate !== 0) {
        await pool.request()
          .input('FromCurrency', sql.VarChar(3), toCurrency)
          .input('ToCurrency', sql.VarChar(3), base)
          .input('Rate', sql.Float, 1 / rate)
          .query(`
            INSERT INTO ExchangeRates (FromCurrency, ToCurrency, Rate, UpdatedAt)
            VALUES (@FromCurrency, @ToCurrency, @Rate, GETDATE())
          `);
      }
    }

    res.status(200).json({ message: `${limit} exchange rates inserted successfully.` });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ message: 'Error fetching exchange rates', error: error.message });
  }
};




