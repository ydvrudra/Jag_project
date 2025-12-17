//controller/invoiceController

const { pool, poolConnect, sql } = require('../config/sqlConfig');
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { extractedExcelFile } = require("../config/constants");
const { analyzeInvoiceWithAzure } = require("../services/azureService");
const { saveToExcelAndDb } = require("../services/exporter");
const { sendInvoiceProcessingSummaryEmail } = require("../services/emailService");

// ==============================================
// NEW ENDPOINT: Called by stored procedure via CURL
// ==============================================
exports.processInvoiceList = async (req, res) => {
  try {
    // 1. Get data sent by stored procedure
    const { recordId, invoices } = req.body;
    
    console.log(`📥 Received request for recordId: ${recordId}`);
    console.log(`📄 Invoices to process: ${invoices ? invoices.length : 0}`);
    
    // 2. Validate request
    if (!recordId) {
      return res.status(400).json({
        success: false,
        message: "recordId is required in request body"
      });
    }
    
    if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
      return res.json({
        success: true,
        message: "No invoices to process",
        recordId: recordId,
        processed: 0
      });
    }
    
    // 3. Process each invoice
    const results = [];
    const errors = [];
    const successFiles = [];
    const failedFiles = [];
    
    // Create temp directory if not exists
    const tempDir = path.join(__dirname, "..", "temp_processing");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    for (const invoice of invoices) {
      const { fileName, fileUrl } = invoice;
      
      console.log(`⏳ Starting processing for: ${fileName}`);
      
      try {
        // ====================================
        // STEP 1: DOWNLOAD FILE
        // ====================================
        const localPath = path.join(tempDir, fileName);
        
        console.log(`⬇️  Downloading from: ${fileUrl}`);
        const writer = fs.createWriteStream(localPath);
        const response = await axios({
          url: fileUrl,
          method: "GET",
          responseType: "stream",
          timeout: 30000
        });
        
        await new Promise((resolve, reject) => {
          response.data.pipe(writer);
          writer.on("finish", resolve);
          writer.on("error", reject);
        });
        
        console.log(`✅ Downloaded: ${fileName}`);
        
        // ====================================
        // STEP 2: AZURE PROCESSING
        // ====================================
        console.log(`🤖 Sending to Azure for analysis: ${fileName}`);
        const azureResult = await analyzeInvoiceWithAzure(localPath);
        
        if (!azureResult || !azureResult.full_json) {
          throw new Error("Azure returned empty result");
        }
        
        // Add filename to result
        azureResult.file = fileName;
        
        // ====================================
        // STEP 3: SAVE TO DATABASE
        // ====================================
        console.log(`💾 Saving to database: ${fileName}`);
        // NOTE: We need to modify saveToExcelAndDb to insert into MAIN tables
        await saveToExcelAndDb([azureResult]);
        
        // ====================================
        // STEP 4: CLEANUP
        // ====================================
        fs.unlinkSync(localPath);
        console.log(`🧹 Cleaned up: ${fileName}`);
        
        // Record success
        results.push({
          fileName: fileName,
          status: "success",
          timestamp: new Date().toISOString()
        });
        successFiles.push(fileName);
        
        console.log(`🎉 Successfully completed: ${fileName}`);
        
      } catch (error) {
        console.error(`❌ Failed to process ${fileName}:`, error.message);
        errors.push({
          fileName: fileName,
          error: error.message,
          timestamp: new Date().toISOString()
        });
        failedFiles.push(fileName);
      }
    }
    
    // 4. Prepare response
    const responseData = {
      success: true,
      message: `Invoice processing completed for recordId: ${recordId}`,
      recordId: recordId,
      totalReceived: invoices.length,
      successfullyProcessed: results.length,
      failed: errors.length,
      successFiles: successFiles,
      failedFiles: failedFiles,
      processingTime: new Date().toISOString()
    };
    
    // 5. Send immediate response
    res.json(responseData);
    
    // 6. Send email summary (async - don't block response)
    if (successFiles.length > 0 || failedFiles.length > 0) {
      setTimeout(async () => {
        try {
          const userEmail = process.env.DEFAULT_EMAIL || "admin@example.com";
          await sendInvoiceProcessingSummaryEmail({
            successCount: successFiles.length,
            failCount: failedFiles.length,
            successFiles: successFiles,
            failFiles: failedFiles,
            attachmentPath: extractedExcelFile,
            toEmail: userEmail,
          });
          console.log("📧 Summary email sent successfully");
        } catch (emailError) {
          console.error("Email sending failed:", emailError.message);
        }
      }, 1000);
    }
    
  } catch (error) {
    console.error("🔥 Fatal error in processInvoiceList:", error.message);
    res.status(500).json({
      success: false,
      message: "Internal server error during invoice processing",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// ==============================================
// EXCEL DOWNLOAD ENDPOINT (existing functionality)
// ==============================================
exports.downloadExcelFile = (req, res) => {
  if (!fs.existsSync(extractedExcelFile)) {
    return res.status(404).json({
      success: false,
      error: "Excel file not found. Process some invoices first."
    });
  }
  
  res.download(extractedExcelFile, `Invoices_${Date.now()}.xlsx`, (err) => {
    if (err) {
      console.error("Excel download error:", err.message);
      // Don't send response if already sent
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Download failed. Please try again."
        });
      }
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



