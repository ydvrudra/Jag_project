//services/databaseFileService
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
const checkRequest = pool.request();

// Placeholders banaye: @file0, @file1, @file2...
uniqueOriginalFiles.forEach((file, index) => {
  checkRequest.input(`file${index}`, sql.VarChar, `%${file}%`);
});

// Single query with OR conditions
const checkQuery = `
  SELECT filename, invoicemain_id, created_datetime 
  FROM invoicesmain 
  WHERE ${uniqueOriginalFiles.map((_, i) => `filename LIKE @file${i}`).join(' OR ')}
  ORDER BY created_datetime DESC
`;

const checkResult = await checkRequest.query(checkQuery);

// 2. PROCESSED FILES KA SET BANAO
const processedFiles = new Set();
const processedDetails = {};

checkResult.recordset.forEach(row => {
  processedFiles.add(row.filename);
  processedDetails[row.filename] = {
    processedDate: row.created_datetime,
    invoiceId: row.invoicemain_id
  };
});

// 3. SEPARATE PROCESSED AND NEW FILES
const filesToProcess = [];
const skippedFiles = [];

for (const originalFile of uniqueOriginalFiles) {
  let isProcessed = false;
  
  // Check if this file is in processed set
  for (const processedFile of processedFiles) {
    if (processedFile.includes(originalFile)) {
      isProcessed = true;
      skippedFiles.push({
        filename: originalFile,
        processedAs: processedFile,
        processedDate: processedDetails[processedFile]?.processedDate,
        reason: 'Already processed'
      });
      break;
    }
  }
  
  if (!isProcessed) {
    filesToProcess.push(originalFile);
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

if (matchingFtpFiles.length > 0) {
  // EK HI QUERY MEIN SAB CHECK KARO
  const ftpCheckRequest = pool.request();
  matchingFtpFiles.forEach((ftpFile, index) => {
    ftpCheckRequest.input(`ftpFile${index}`, sql.VarChar, ftpFile);
  });
  
  const ftpCheckQuery = `
    SELECT filename FROM invoicesmain 
    WHERE filename IN (${matchingFtpFiles.map((_, i) => `@ftpFile${i}`).join(', ')})
  `;
  
  const ftpCheckResult = await ftpCheckRequest.query(ftpCheckQuery);
  
  if (ftpCheckResult.recordset.length > 0) {
    alreadyProcessed = true;
    processedFileName = ftpCheckResult.recordset[0].filename;
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
      console.timeEnd('FTP Download');
      
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