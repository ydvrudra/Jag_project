//services/ftpService
const ftp = require("basic-ftp");
const fs = require("fs"); 
const path = require("path");

// ✅ CONNECTION POOL
let activeConnection = null;
let lastUsedTime = Date.now();
const CONNECTION_TIMEOUT = 30000; // 30 seconds

// ✅ GET OR CREATE CONNECTION
async function getFtpConnection() {
  const now = Date.now();
  
  // Reuse existing connection if fresh
  if (activeConnection && (now - lastUsedTime) < CONNECTION_TIMEOUT) {
    lastUsedTime = now;
    return activeConnection;
  }
  
  if (activeConnection) {
    try {
      activeConnection.close();
    } catch (err) {
      // Ignore close errors
    }
    activeConnection = null;
  }
  
  // Create new connection
  const client = new ftp.Client();
  client.ftp.verbose = false; // Disable verbose logging
  
  await client.access({
    host: process.env.FTP_HOST,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    secure: false,
  });
  
  activeConnection = client;
  lastUsedTime = now;
  return client;
}

// ✅ UPLOAD WITH REUSED CONNECTION
async function uploadToFtp(localPath, fileName) {
  const client = await getFtpConnection();
  
  try {
    await client.uploadFrom(localPath, `/public_html/UserData/Invoices/Processed_Invoices/${fileName}`);
    lastUsedTime = Date.now();
    //console.log(`FTP Upload successful: ${fileName}`);
  } catch (err) {
    console.error(`FTP upload error for ${fileName}:`, err.message);
    // Reset connection on error
    activeConnection = null;
    throw err;
  }
}

// ✅ DELETE WITH REUSED CONNECTION
async function deleteFromFtpAfterProcessing(fileName) {
  const client = await getFtpConnection();
  
  try {
    const decodedFileName = decodeURIComponent(fileName);
    const remotePath = `/public_html/UserData/Invoices/UploadInvoice/${decodedFileName}`;
    
    // Small delay for FTP server reliability
    await new Promise((r) => setTimeout(r, 300));
    await client.remove(remotePath);
    
    // Verify deletion
    const list = await client.list("/public_html/UserData/Invoices/UploadInvoice/");
    const stillThere = list.some((f) => f.name === decodedFileName);
    
    if (stillThere) {
      throw new Error(`FTP delete failed for ${decodedFileName}`);
    }
    
    lastUsedTime = Date.now();
    //console.log(`Successfully deleted FTP file: ${decodedFileName}`);
  } catch (err) {
    console.error(`FTP delete error for ${fileName}:`, err.message);
    activeConnection = null;
    throw err;
  }
}

// ✅ DOWNLOAD WITH REUSED CONNECTION
async function downloadFromFtp(fileName) {
  const client = await getFtpConnection();
  
  // Create temp downloads folder
  const tempDir = path.join(__dirname, '../temp_downloads');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const localPath = path.join(tempDir, fileName);
  
  try {
    const remotePath = `/public_html/UserData/Invoices/UploadInvoice/${fileName}`;
    //console.log(`⬇️ Downloading from FTP: ${remotePath}`);
    
    await client.downloadTo(localPath, remotePath);
    
    lastUsedTime = Date.now();
    //console.log(`✅ FTP Download successful: ${fileName}`);
    return localPath;
    
  } catch (err) {
    console.error(`FTP download error for ${fileName}:`, err.message);
    activeConnection = null;
    throw err;
  }
}

// ✅ CLEANUP FUNCTION (Optional)
function cleanupFtpConnection() {
  if (activeConnection) {
    try {
      activeConnection.close();
    } catch (err) {
      // Ignore
    }
    activeConnection = null;
  }
}

// Auto cleanup on process exit
process.on('exit', cleanupFtpConnection);
process.on('SIGINT', cleanupFtpConnection);

module.exports = { 
  uploadToFtp, 
  deleteFromFtpAfterProcessing, 
  downloadFromFtp,
  cleanupFtpConnection
};