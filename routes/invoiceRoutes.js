const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const { uploadDir, extractedExcelFile } = require("../config/constants");
const { analyzeInvoiceWithAzure } = require("../services/azureService");
const { uploadToFtp } = require("../services/ftpService");
const { saveToExcel } = require("../utils/excelHelper");

const router = express.Router();

router.get("/process-one-invoice", async (req, res) => {
  try {
    const baseUrl = "http://sja.jagsoftware.in/UserData/UploadInvoice/";
    const html = await axios.get(baseUrl);
    const $ = cheerio.load(html.data);

    const pdfLinks = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && href.toLowerCase().endsWith(".pdf")) {
        const fullUrl = new URL(href, baseUrl).href;
        const fileName = fullUrl.split("/").pop();
        const localPath = path.join(uploadDir, fileName);
        if (!fs.existsSync(localPath)) {
          pdfLinks.push({ fullUrl, fileName });
        }
      }
    });

    if (pdfLinks.length === 0) {
      return res.json({ message: "No new PDF files found to download." });
    }

    const { fullUrl, fileName } = pdfLinks[0];
    const localPath = path.join(uploadDir, fileName);
    console.log(`Downloading: ${fileName}`);

    const writer = fs.createWriteStream(localPath);
    const fileRes = await axios({ url: fullUrl, method: "GET", responseType: "stream" });

    await new Promise((resolve, reject) => {
      fileRes.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    console.log("Downloaded:", fileName);

    const result = await analyzeInvoiceWithAzure(localPath);
    if (!result) throw new Error("Azure training failed");

    result.file = fileName;
    saveToExcel([result]);

    await uploadToFtp(localPath, fileName);
    fs.unlinkSync(localPath);

    res.json({
      status: "done",
      message: "Processed and uploaded one invoice",
      extracted: result,
    });
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).json({ error: "Processing failed", details: err.message });
  }
});

router.get("/download-excel", (req, res) => {
  if (!fs.existsSync(extractedExcelFile)) {
    return res.status(404).json({ error: "Excel file not found." });
  }

  res.download(extractedExcelFile, "Extracted_Invoices.xlsx", (err) => {
    if (err) {
      console.error("❌ Excel download error:", err.message);
      res.status(500).json({ error: "Download failed." });
    }
  });
});

module.exports = router;
