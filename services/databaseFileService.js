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
      console.log('📭 No invoices found in database');
      return [];
    }
    
    const fileString = result.recordset[0].UploadInvoice;
    console.log('📋 Database filenames:', fileString);
    
    const filenames = fileString.split(',')
      .map(f => f.trim())
      .filter(f => f && f.toLowerCase().endsWith('.pdf'));
    
    if (filenames.length === 0) {
      console.log('📭 No PDF files found in database string');
      return [];
    }
    
    console.log('📄 Files from database:', filenames);
    
    // ✅ ENHANCED VALIDATION: Check already processed files
    console.log('🔍 Checking already processed files...');
    const processedFiles = [];

    for (const filename of filenames) {
      // Step 1: Extract original filename (remove "1-" prefix if exists)
      const originalName = filename.replace(/^1-/, ''); // "WHLAHMEOD2505725.pdf"
      
      // Step 2: Check if ANY variation of this file is already processed
      const checkResult = await pool.request()
        .input('pattern', sql.VarChar, `%${originalName}%`)
        .query(`
          SELECT filename, invoicemain_id, created_datetime 
          FROM invoicesmain 
          WHERE filename LIKE @pattern
          ORDER BY created_datetime DESC
        `);
      
      if (checkResult.recordset.length > 0) {
        console.log(`💰 SKIPPING - Already processed as: ${checkResult.recordset[0].filename}`);
        console.log(`   📅 Processed on: ${checkResult.recordset[0].created_datetime}`);
      } else {
        processedFiles.push(filename);
        console.log(`✅ To process: ${filename}`);
      }
    }
    
    if (processedFiles.length === 0) {
      console.log('📭 All files already processed - NO AZURE CHARGE!');
      return [];
    }
    
    console.log('📄 Files to download (not processed yet):', processedFiles);
    
    // List files on FTP
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
    console.log('📁 Files on FTP server:', ftpFileNames);
    
    client.close();
    
    // ✅ SMART MATCHING for procedure pattern: X-1-OriginalFile.pdf
    const filesData = [];
    
    for (const dbFilename of processedFiles) {
      let actualFtpFilename = null;
      
      // Step 1: Get original filename (remove "1-" prefix)
      const originalName = dbFilename.replace(/^1-/, ''); // "WHLAHMEOD2505725.pdf"
      
      console.log(`\n🔍 Matching: ${dbFilename} -> Original: ${originalName}`);
      
      // Step 2: Find ALL files matching pattern X-1-originalName
      const matchingFiles = ftpFileNames.filter(ftpFile => {
        // Check if ftpFile contains originalName AND follows X-1-originalName pattern
        return ftpFile.includes(`-${originalName}`);
      });
      
      if (matchingFiles.length > 0) {
        console.log(`📁 Found ${matchingFiles.length} matches:`, matchingFiles);
        
        // Get the LATEST file (highest RecordId = most recent)
        const getRecordId = (fname) => {
          const match = fname.match(/^(\d+)-/);
          return match ? parseInt(match[1]) : 0;
        };
        
        matchingFiles.sort((a, b) => getRecordId(b) - getRecordId(a));
        actualFtpFilename = matchingFiles[0];
        
        console.log(`✅ Selected latest: ${actualFtpFilename}`);
        
        // ✅ FINAL CHECK: Double verify not processed (safety net)
        const finalCheck = await pool.request()
          .input('ftpFilename', sql.VarChar, actualFtpFilename)
          .query(`SELECT TOP 1 filename FROM invoicesmain WHERE filename = @ftpFilename`);
        
        if (finalCheck.recordset.length > 0) {
          console.log(`⚠️  WARNING: ${actualFtpFilename} already in database! Skipping download.`);
          continue; // Skip download completely
        }
        
        try {
          console.log(`🔄 Downloading: ${actualFtpFilename}`);
          const localPath = await downloadFromFtp(actualFtpFilename);
          
          const stats = require('fs').statSync(localPath);
          filesData.push({
            dbFilename: dbFilename,
            ftpFilename: actualFtpFilename,
            filePath: localPath,
            fileSize: stats.size,
            originalName: originalName
          });
          
          console.log(`✅ Added to queue: ${actualFtpFilename} (${stats.size} bytes)`);
        } catch (err) {
          console.error(`❌ Download failed:`, err.message);
        }
      } else {
        console.log(`❌ No matching file found on FTP for: ${dbFilename}`);
        console.log(`   Looking for pattern: X-1-${originalName}`);
      }
    }
    
    console.log(`\n📊 Total files ready for processing: ${filesData.length}`);
    
    if (filesData.length === 0) {
      console.log('💡 Tip: All matched files were already processed. No Azure charges incurred.');
    }
    
    return filesData;
    
  } catch (err) {
    console.error('💥 Error:', err.message);
    return [];
  }
}

module.exports = { getInvoiceFilesFromDb };