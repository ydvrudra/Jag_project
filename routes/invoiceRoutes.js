const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const { uploadDir, extractedExcelFile } = require("../config/constants");
const { analyzeInvoiceWithAzure } = require("../services/azureService");
const { uploadToFtp ,deleteFromFtpAfterProcessing } = require("../services/ftpService");
const { saveToExcel } = require("../services/excelhelper");


const router = express.Router();

router.get("/process-all-invoices", async (req, res) => {
  try {
    const baseUrl = "http://www.study.jagsoftware.in/public_html/UserData/Invoices/UploadInvoice/";  
    const html = await axios.get(baseUrl); 
    const $ = cheerio.load(html.data);

    const pdfLinks = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && href.toLowerCase().endsWith(".pdf")) {
        const fullUrl = new URL(href, baseUrl).href;
        const fileName = fullUrl.split("/").pop();
        const localPath = path.join(uploadDir, fileName);
        // Remove condition checking file existence here
        // So that all pdfs get processed every time
        pdfLinks.push({ fullUrl, fileName, localPath });
      }
    });

    if (pdfLinks.length === 0) {
      return res.json({ message: "No PDF files found to process." });
    }

    const results = [];
    const errors = [];

    for (const { fullUrl, fileName, localPath } of pdfLinks) {
      try {
        console.log(`📥 Downloading: ${fileName}`);

        // Download file fresh every time (overwrite existing)
        const writer = fs.createWriteStream(localPath);
        const fileRes = await axios({ url: fullUrl, method: "GET", responseType: "stream" });

        await new Promise((resolve, reject) => {
          fileRes.data.pipe(writer);
          writer.on("finish", resolve);
          writer.on("error", reject);
        });

        console.log(" Downloaded:", fileName);

        // Process the invoice via Azure
        const result = await analyzeInvoiceWithAzure(localPath);
        if (!result) throw new Error("Azure training failed");

        result.file = fileName;
        saveToExcel([result]);

        await uploadToFtp(localPath, fileName);
        await deleteFromFtpAfterProcessing(fileName);

        try {
          fs.unlinkSync(localPath);
          console.log("🗑️ File deleted after successful processing.");
        } catch (err) {
          console.error("⚠️ File delete failed:", err.message);
        }

        results.push({ fileName, status: "success" });

      } catch (err) {
        console.error(`❌ Failed processing ${fileName}:`, err.message);
        errors.push({ fileName, error: err.message });
      }
    }

    res.json({
      status: "done",
      processed: results.length,
      failed: errors.length,
      details: { success: results, errors },
    });

  } catch (err) {
    console.error("Error in processing invoices:", err.message);
    res.status(500).json({ error: "Processing failed", details: err.message });
  }
});


router.get("/download-excel", (req, res) => {
  if (!fs.existsSync(extractedExcelFile)) {
    return res.status(404).json({ error: "Excel file not found." });
  }

  res.download(extractedExcelFile, "Invoices.xlsx", (err) => {
    if (err) {
      console.error(" Excel download error:", err.message);
      res.status(500).json({ error: "Download failed." });
    }
  });
});

module.exports = router;