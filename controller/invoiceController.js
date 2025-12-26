//controller/invoiceController.js
const { pool, poolConnect, sql } = require('../config/sqlConfig');
const fs = require("fs");
const { extractedExcelFile } = require("../config/constants");
const { getInvoiceFilesFromDb } = require("../services/databaseFileService");
const { processInvoice } = require("../services/invoiceProcessor");
const { sendInvoiceProcessingSummaryEmail } = require("../services/emailService");

// ✅ BACKGROUND PROCESSING QUEUE
let isProcessing = false;
const pendingQueue = [];

async function processQueueBackground() {
  if (isProcessing) return;
  
  isProcessing = true;
  
  while (pendingQueue.length > 0) {
    const job = pendingQueue.shift();
    
    try {
      console.log(`🔄 Background processing started for ${job.filesToProcess.length} files`);
      
      const results = [];
      const errors = [];
      const successFiles = [];
      const failFiles = [];
      
      // Process each file
      for (const [index, fileData] of job.filesToProcess.entries()) {
        try {
          const processResult = await processInvoice(fileData.filePath, fileData.ftpFilename);
          
          if (processResult && processResult.success === true) {
            const fileName = processResult.fileName || fileData.ftpFilename || 'Unknown';
            results.push({ 
              fileName: fileName, 
              status: "success"
            });
            successFiles.push(fileName);
          } else {
            throw new Error(processResult?.error || "Processing failed");
          }
        } catch (err) {
          const fileName = fileData.ftpFilename || 'Unknown';
          errors.push({ fileName: fileName, error: err.message });
          failFiles.push(fileName);
        }
      }
      
      // Send email if there are results
      if (job.userEmail && (results.length > 0 || errors.length > 0)) {
        try {
          await sendInvoiceProcessingSummaryEmail({
            successCount: results.length,
            failCount: errors.length,
            successFiles: results.map(r => r.fileName),
            failFiles: errors,
            skippedFiles: job.skippedFiles || [],
            attachmentPath: extractedExcelFile,
            toEmail: job.userEmail,
          });
          console.log("📧 Summary email sent successfully");
        } catch (emailErr) {
          console.error("❌ Email send failed:", emailErr.message);
        }
      }
      
      console.log(`✅ Background processing completed. Success: ${results.length}, Failed: ${errors.length}`);
      
    } catch (err) {
      console.error("💥 Background processing error:", err.message);
    }
  }
  
  isProcessing = false;
}

// ✅ MAIN ENDPOINT - IMMEDIATE RESPONSE ONLY
exports.processAllInvoices = async (req, res) => {
  try {
    // 1. Get files from database
    const result = await getInvoiceFilesFromDb();
    const filesToProcess = result.filesToProcess || [];
    const skippedFiles = result.skippedFiles || [];
    
    // 2. IMMEDIATE RESPONSE (2 seconds max)
    res.json({ 
      status: "queued", 
      message: "Invoice processing started in background",
      filesFound: filesToProcess.length,
      skipped: skippedFiles.length,
      queuedAt: new Date().toISOString()
    });
    
    // 3. If no files, return early
    if (filesToProcess.length === 0 && skippedFiles.length === 0) {
      console.log('📭 No files found to process');
      return;
    }
    
    // 4. Add job to background queue
    pendingQueue.push({
      filesToProcess,
      skippedFiles,
      userEmail: req.headers["email"] || process.env.DEFAULT_EMAIL
    });
    
    // 5. Start background processing (5 second delay)
    setTimeout(processQueueBackground, 5000);
    
  } catch (err) {
    // Only log error, response already sent
    console.error("Error in processAllInvoices:", err.message);
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