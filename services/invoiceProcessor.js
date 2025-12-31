const fs = require("fs");
const path = require("path");
const { analyzeInvoiceWithAzure } = require("./azureService");
const { uploadToFtp, deleteFromFtpAfterProcessing } = require("./ftpService");
const { saveToExcel } = require("./excelhelper");

exports.processInvoice = async (filePath, fileName,recordId) => {
  try {
   // console.log(`\n🚀 Starting processing: ${fileName}`);
    
    // 1. Verify file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`Downloaded file not found: ${filePath}`);
    }
    
    const stats = fs.statSync(filePath);
   // console.log(`📄 File size: ${stats.size} bytes`);
    
    if (stats.size === 0) {
      throw new Error("File is empty");
    }
    
    // 2. Process with Azure
    console.time('Azure Processing');
    const azureResult = await analyzeInvoiceWithAzure(filePath);
    console.timeEnd('Azure Processing');
    
    if (!azureResult || !azureResult.full_json) {
      throw new Error("Azure analysis failed");
    }
    
   // console.log(`✅ Azure analysis succeeded`);
    
    // 3. Save to DB and Excel
  //  console.log(`💾 Saving to Excel and database...`);
    const saveResult = await saveToExcel([{
      file: fileName,
      full_json: azureResult.full_json
    }], recordId);
    
    console.log(`✅ Database/Excel save completed`);
    
    // ✅ 4. FTP Operations (ONLY if DB save successful)
  //  console.log(`📤 Uploading to FTP processed folder...`);
    await uploadToFtp(filePath, fileName);
    
  //  console.log(`🗑️  Deleting from FTP upload folder...`);
    await deleteFromFtpAfterProcessing(fileName);
    
  //  console.log(`✅ File moved to processed folder`);
    
    // 5. Cleanup local file
    try {
      fs.unlinkSync(filePath);
    //  console.log(`🧹 Local temp file deleted`);
    } catch (err) {
      console.warn(`⚠️  Could not delete local file: ${err.message}`);
    }
    
  //  console.log(`🎉 Processing completed successfully: ${fileName}`);
    
    return { 
      success: true, 
      fileName: fileName,
      fileSize: stats.size,
      dbInserted: true,
      ftpDeleted: true
    };
    
  } catch (error) {
    console.error(` Error processing invoice ${fileName}:`, error.message);
    
    // Cleanup local file on error
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (cleanupErr) {
      console.warn(`  Could not cleanup temp file`);
    }
    
    return { 
      success: false, 
      fileName: fileName,
      error: error.message
    };
  }
};