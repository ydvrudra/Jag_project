//controller/invoiceController

const axios = require('axios');
const { pool, poolConnect, sql } = require('../config/sqlConfig');
const fs = require("fs");
const { extractedExcelFile } = require("../config/constants");
const { scrapePdfLinks } = require("../services/scraperService");
const { processInvoice } = require("../services/invoiceProcessor");
const { sendInvoiceProcessingSummaryEmail } = require("../services/emailService");


exports.processAllInvoices = async (req, res) => {
  try {
    const pdfLinks = await scrapePdfLinks();

    if (pdfLinks.length === 0) {
      return res.json({ message: "No PDF files found to process." });
    }

    const results = [];
    const errors = [];
     const successFiles = []; 
    const failFiles = [];   

    for (const { fullUrl, fileName, localPath } of pdfLinks) {
      try {
        await processInvoice(fullUrl, fileName, localPath);
        results.push({ fileName, status: "success" });
        successFiles.push(fileName); 
      } catch (err) {
        console.error(` Failed: ${fileName}`, err.message);
        errors.push({ fileName, error: err.message });
        failFiles.push(fileName); 
      }
    }

    res.json({
      status: "done",
      processed: results.length,
      failed: errors.length,
      details: { success: results, errors },
    });

    const excelPath = extractedExcelFile;
   const userEmail = req.headers["email"] || process.env.DEFAULT_EMAIL;

    try {
  await sendInvoiceProcessingSummaryEmail({
    successCount: results.length,
    failCount: errors.length,
    successFiles: successFiles, 
    failFiles: failFiles,
    attachmentPath: excelPath,
    toEmail: userEmail,
  });
  console.log("📧 Summary email sent");
} catch (emailErr) {
  console.error("❌ Email send failed:", emailErr.message);
}



  } catch (err) {
    console.error(" Error processing invoices:", err.message);
    res.status(500).json({ error: "Processing failed", details: err.message });
  }
};

exports.downloadExcelFile = (req, res) => {
  if (!fs.existsSync(extractedExcelFile)) {
    return res.status(404).json({ error: "Excel file not found." });
  }

  res.download(extractedExcelFile, "Invoices.xlsx", (err) => {
    if (err) {
      console.error(" Excel download error:", err.message);
      res.status(500).json({ error: "Download failed." });
    }
  });
};




exports.fetchExchangeRates = async (req, res) => {
  try {
    await poolConnect;  

    const response = await axios.get("https://api.exchangerate-api.com/v4/latest/USD");
    const { base, rates } = response.data;

    for (let [toCurrency, rate] of Object.entries(rates)) {
      
      // USD to Other
      await pool.request()
        .input('FromCurrency', sql.VarChar(3), base)
        .input('ToCurrency', sql.VarChar(3), toCurrency)
        .input('Rate', sql.Float, rate)
        .query(`
          INSERT INTO ExchangeRates (FromCurrency, ToCurrency, Rate, UpdatedAt)
          VALUES (@FromCurrency, @ToCurrency, @Rate, GETDATE())
        `);

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

    res.status(200).json({ message: 'Exchange rates inserted successfully.' });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ message: 'Error fetching exchange rates', error: error.message });
  }
};


