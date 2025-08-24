const ftp = require("basic-ftp");

async function uploadToFtp(localPath, fileName) {
  const client = new ftp.Client();
  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      secure: false,
    });
    await client.uploadFrom(localPath, `/public_html/UserData/Invoices/Processed_Invoices/${fileName}`);
    console.log("Uploaded to FTP:", fileName);
  } catch (err) {
    console.error("FTP upload error:", err.message);
    throw err;
  } finally {
    client.close();
  }
}

async function deleteFromFtpAfterProcessing(fileName) {
  const client = new ftp.Client();
  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      secure: false,
    });

    const decodedFileName = decodeURIComponent(fileName); // Fix here
    const remotePath = `/public_html/UserData/Invoices/UploadInvoice/${decodedFileName}`;
    console.log("Attempting to delete remote file:", remotePath);

    // Small delay for FTP reliability
    await new Promise((r) => setTimeout(r, 300));
    await client.remove(remotePath);

    const list = await client.list("/public_html/UserData/Invoices/UploadInvoice/");
    const stillThere = list.some((f) => f.name === decodedFileName);
    if (stillThere) {
      console.error("FTP delete failed – file still present:", decodedFileName);
    } else {
      console.log("Successfully deleted from FTP:", decodedFileName);
    }
  } catch (err) {
    console.error("FTP delete error:", err.message);
  } finally {
    client.close();
  }
}


module.exports = {
  uploadToFtp,
  deleteFromFtpAfterProcessing,
};
