const { pool, sql } = require('../config/sqlConfig');
const { downloadFromFtp } = require('./ftpService');

async function getInvoiceFilesFromDb() {
  try {
    // Get latest uploaded invoices
    const result = await pool.request().query(`
      SELECT UploadInvoice 
      FROM InvoiceuploadHdr 
      WHERE InvoiceuploadHdrId = (SELECT MAX(InvoiceuploadHdrId) FROM InvoiceuploadHdr)
    `);
    
    if (result.recordset.length === 0) {
     // console.log('📭 No invoices found in database');
      return [];
    }
    
    const fileString = result.recordset[0].UploadInvoice;
   // console.log('📋 Database filenames:', fileString);
    
    // Split and clean filenames
    const dbFilenames = fileString.split(',')
      .map(f => f.trim())
      .filter(f => f && f.toLowerCase().endsWith('.pdf'));
    
    if (dbFilenames.length === 0) {
   //   console.log('📭 No PDF files found');
      return [];
    }
    
   // console.log('📄 Files from database:', dbFilenames);
    
    // 🟢 STEP 1: Extract ORIGINAL filenames (remove "1-", "2-" prefixes)
    const originalFiles = dbFilenames.map(filename => {
      // Remove "1-", "2-", "3-" prefixes
      return filename.replace(/^[0-9]+-/, '');
    });
    
    // Remove duplicates
    const uniqueOriginalFiles = [...new Set(originalFiles)];
   // console.log('📄 Original filenames (without prefixes):', uniqueOriginalFiles);
    
    // 🟢 STEP 2: Check which files are already processed
   // console.log('🔍 Checking already processed files...');
    const filesToProcess = [];
    const skippedFiles = [];
    
    for (const originalFile of uniqueOriginalFiles) {
      // Check in invoicesmain table with ORIGINAL filename
          const checkResult = await pool.request()
        .input('pattern', sql.VarChar, `%${originalFile}%`)
        .query(`
          SELECT filename, invoicemain_id, created_datetime 
          FROM invoicesmain 
          WHERE filename LIKE @pattern
          ORDER BY created_datetime DESC
        `);
      
      if (checkResult.recordset.length > 0) {
        skippedFiles.push({
          filename: originalFile,
          processedAs: checkResult.recordset[0].filename,
          processedDate: checkResult.recordset[0].created_datetime,
          reason: 'Already processed'
        });
       // console.log(`💰 SKIPPING - Already processed: ${originalFile}`);
       // console.log(`   📅 Processed on: ${checkResult.recordset[0].created_datetime}`);
      } else {
        filesToProcess.push(originalFile);
       // console.log(`✅ To process: ${originalFile}`);
      }
    }
    
    
    if (filesToProcess.length === 0) {
     // console.log('📭 All files already processed - NO AZURE CHARGE!');
      return [];
    }
    
   // console.log('📄 Files to process (original names):', filesToProcess);
    
    // 🟢 STEP 3: Get files from FTP
   // console.log('🔍 Listing files on FTP server...');
    const ftp = require('basic-ftp');
    const client = new ftp.Client();
    
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      secure: false,
    });
    
    const ftpFiles = await client.list('/public_html/UserData/Invoices/UploadInvoice/');
    const ftpFileNames = ftpFiles.map(f => f.name);
   // console.log('📁 Total files on FTP:', ftpFileNames.length);
    
    // Show recent files for debugging
   // console.log('📁 Recent FTP files:');
    ftpFileNames.slice(-10).forEach(f => console.log(`   ${f}`));
    
    client.close();
    
   // 🟢 STEP 4: Match and download files
const filesData = [];

for (const originalFile of filesToProcess) {
 // console.log(`\n🔍 Looking for: ${originalFile}`);
  
  const matchingFtpFiles = ftpFileNames.filter(ftpFile => {
    return ftpFile.endsWith(originalFile);
  });
  
  if (matchingFtpFiles.length > 0) {
   // console.log(`📁 Found ${matchingFtpFiles.length} matches:`, matchingFtpFiles);
    
    // Check if ANY of these files is already processed
    let alreadyProcessed = false;
    let processedFileName = '';
    
    for (const ftpFile of matchingFtpFiles) {
      const check = await pool.request()
        .input('ftpFilename', sql.VarChar, ftpFile)
        .query(`SELECT filename FROM invoicesmain WHERE filename = @ftpFilename`);
      
      if (check.recordset.length > 0) {
        alreadyProcessed = true;
        processedFileName = ftpFile;
        break;
      }
    }
    
    if (alreadyProcessed) {
      console.log(`💰 Already processed: ${processedFileName}`);
      continue; // Skip this file completely
    }
    
    // Select the latest one (highest RecordId)
    const getRecordId = (filename) => {
      const match = filename.match(/^(\d+)-/);
      return match ? parseInt(match[1]) : 0;
    };
    
    matchingFtpFiles.sort((a, b) => getRecordId(b) - getRecordId(a));
    const selectedFtpFile = matchingFtpFiles[0];
    
    console.log(`✅ Selected: ${selectedFtpFile}`);
    
    try {
      console.log(`🔄 Downloading: ${selectedFtpFile}`);
      const localPath = await downloadFromFtp(selectedFtpFile);
      
      const stats = require('fs').statSync(localPath);
      filesData.push({
        originalName: originalFile,
        ftpFilename: selectedFtpFile,
        filePath: localPath,
        fileSize: stats.size
      });
      
     // console.log(`✅ Added to queue: ${originalFile} (${stats.size} bytes)`);
    } catch (err) {
      console.error(`❌ Download failed:`, err.message);
    }
  } else {
    console.log(`❌ No matching file found on FTP for: ${originalFile}`);
  }
}
    
    // console.log(`\n📊 Summary:`);
    // console.log(`   Database files: ${dbFilenames.length}`);
    // console.log(`   Original files: ${uniqueOriginalFiles.length}`);
    // console.log(`   To process: ${filesToProcess.length}`);
    // console.log(`   Ready for Azure: ${filesData.length}`);
    
    if (filesData.length === 0) {
     // console.log('💡 All files were either already processed or not found on FTP');
    }
    
    return {
      filesToProcess: filesData, // Download & process karne wali
      skippedFiles: skippedFiles // Skip hone wali
    };
    
  } catch (err) {
    console.error('💥 Error:', err.message);
    return { filesToProcess: [], skippedFiles: [] };
  }
}

module.exports = { getInvoiceFilesFromDb };