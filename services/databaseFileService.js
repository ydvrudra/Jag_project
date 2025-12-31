//services/databaseFileService
const { pool, sql } = require('../config/sqlConfig');
const { downloadFromFtp } = require('./ftpService');

async function getInvoiceFilesFromDb(recordId) {
  try {
    // Get latest uploaded invoices
    const result = await pool.request().query(`
      SELECT UploadInvoice 
      FROM InvoiceuploadHdr 
      WHERE InvoiceuploadHdrId = (SELECT MAX(InvoiceuploadHdrId) FROM InvoiceuploadHdr)
    `);
    
    if (result.recordset.length === 0) {
      console.log('📭 No invoices found in database');
      return { filesToProcess: [], skippedFiles: [] };
    }
    
    const fileString = result.recordset[0].UploadInvoice;
    console.log('📋 Database filenames:', fileString);
    
    const dbFilenames = fileString.split(',')
      .map(f => f.trim())
      .filter(f => f && f.toLowerCase().endsWith('.pdf'));
    
    if (dbFilenames.length === 0) {
      console.log('📭 No PDF files found');
      return { filesToProcess: [], skippedFiles: [] };
    }
    
    console.log('📄 Files from database:', dbFilenames);
    
    // 🟢 STEP 1: Extract ORIGINAL filenames
    const originalFiles = dbFilenames.map(filename => {
      return filename.replace(/^[0-9]+-/, '');
    });
    
    // Remove duplicates
    const uniqueOriginalFiles = [...new Set(originalFiles)];
    console.log('📄 Original filenames (without prefixes):', uniqueOriginalFiles);
    
    // 🟢 STEP 2: Check which files are already processed
    console.log('🔍 Checking already processed files...');
    const filesToProcess = [];
    const skippedFiles = [];
    
    for (const originalFile of uniqueOriginalFiles) {
      try {
        // ✅ Check: Same RecordId + Same File
        const checkResult = await pool.request()
          .input('originalFile', sql.VarChar, `%${originalFile}%`)
          .input('recordId', sql.Int, recordId)
          .query(`
            SELECT filename, invoicemain_id, created_datetime 
            FROM invoicesmain 
            WHERE UploadHeaderId = @recordId
              AND filename LIKE @originalFile
            ORDER BY created_datetime DESC
          `);
        
        if (checkResult.recordset.length > 0) {
          // Same RecordId + Same File → SKIP
          skippedFiles.push({
            filename: originalFile,
            processedAs: checkResult.recordset[0].filename,
            processedDate: checkResult.recordset[0].created_datetime,
            reason: 'Already processed in same upload session'
          });
          console.log(`💰 SKIPPING (same session): ${originalFile}`);
        } else {
          // ✅ Check if processed in DIFFERENT RecordId
          const checkOtherRecord = await pool.request()
            .input('originalFile', sql.VarChar, `%${originalFile}%`)
            .input('recordId', sql.Int, recordId)
            .query(`
              SELECT filename, invoicemain_id, UploadHeaderId
              FROM invoicesmain 
              WHERE filename LIKE @originalFile
                AND UploadHeaderId IS NOT NULL
                AND UploadHeaderId != @recordId
            `);
          
          if (checkOtherRecord.recordset.length > 0) {
            // Different RecordId + Same File → PROCESS
            filesToProcess.push(originalFile);
            console.log(`✅ To process (different upload session): ${originalFile}`);
          } else {
            // Never processed before → PROCESS
            filesToProcess.push(originalFile);
            console.log(`✅ To process (new file): ${originalFile}`);
          }
        }
      } catch (err) {
        console.error(`❌ Error checking file ${originalFile}:`, err.message);
      }
    }
    
    // 🟢 STEP 3: Get files from FTP
    console.log('🔍 Listing files on FTP server...');
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
    console.log('📁 Total files on FTP:', ftpFileNames.length);
    
    client.close();
    
    // 🟢 STEP 4: Match and download files
    const filesData = [];
    
    for (const originalFile of filesToProcess) {
      console.log(`\n🔍 Looking for: ${originalFile}`);
      
      const matchingFtpFiles = ftpFileNames.filter(ftpFile => {
        return ftpFile.endsWith(originalFile);
      });
      
      if (matchingFtpFiles.length > 0) {
        console.log(`📁 Found ${matchingFtpFiles.length} matches:`, matchingFtpFiles);
        
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
          
          console.log(`✅ Added to queue: ${originalFile} (${stats.size} bytes)`);
        } catch (err) {
          console.error(`❌ Download failed:`, err.message);
        }
      } else {
        console.log(`❌ No matching file found on FTP for: ${originalFile}`);
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   Database files: ${dbFilenames.length}`);
    console.log(`   Original files: ${uniqueOriginalFiles.length}`);
    console.log(`   To process: ${filesToProcess.length}`);
    console.log(`   Ready for Azure: ${filesData.length}`);
    console.log(`   Skipped: ${skippedFiles.length}`);
    
    return {
      filesToProcess: filesData, 
      skippedFiles: skippedFiles 
    };
    
  } catch (err) {
    console.error('💥 Error:', err.message);
    return { filesToProcess: [], skippedFiles: [] };
  }
}

module.exports = { getInvoiceFilesFromDb };