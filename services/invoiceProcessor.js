//services/invoiceProcessor
const fs = require("fs");
const axios = require("axios");
const { analyzeInvoiceWithAzure } = require("./azureService");
const { uploadToFtp, deleteFromFtpAfterProcessing } = require("./ftpService");
const { saveToExcel } = require("./excelhelper");


exports.processInvoice = async (fullUrl, fileName, localPath) => {
  try {
    console.log(` Downloading: ${fileName}`);

    // Download PDF
    const writer = fs.createWriteStream(localPath);
    const fileRes = await axios({ url: fullUrl, method: "GET", responseType: "stream" });

    await new Promise((resolve, reject) => {
      fileRes.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    console.log(` Downloaded: ${fileName}`);

    // Process with Azure
    const result = await analyzeInvoiceWithAzure(localPath);
    if (!result) throw new Error("Azure training failed");

    result.file = fileName;

    // Save result to Excel
    saveToExcel([result]);

    // FTP Upload + Cleanup
    await uploadToFtp(localPath, fileName);
    await deleteFromFtpAfterProcessing(fileName);

    // Local file delete
    try {
      fs.unlinkSync(localPath);
      console.log("🗑️ File deleted after processing.");
    } catch (err) {
      console.warn(" File deletion failed:", err.message);
    }

    // Return success
    return { success: true };

  } catch (error) {
    console.error(`Error processing invoice ${fileName}:`, error.message || error);
    return { success: false, error };
  }
};