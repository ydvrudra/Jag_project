const ftp = require("basic-ftp");

async function uploadToFtp(localPath, remoteFileName) {
  const client = new ftp.Client();
  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      secure: false,
    });

    const remotePath = `${process.env.FTP_REMOTE_DIR.replace(/\/$/, "")}/${remoteFileName}`;
    console.log("Uploading to:", remotePath);
    await client.uploadFrom(localPath, remotePath);
    console.log(" FTP Upload Success:", remoteFileName);
  } catch (err) {
    console.error("FTP Upload Failed:", remoteFileName, err.message);
    throw err;
  } finally {
    client.close();
  }
}

// ✅ NEW FUNCTION: Delete remote file from FTP after processing
// async function deleteFromFtpAfterProcessing(remoteFileName) {
//   const client = new ftp.Client();
//   try {
//     await client.access({
//       host: process.env.FTP_HOST,
//       user: process.env.FTP_USER,
//       password: process.env.FTP_PASSWORD,
//       secure: false,
//     });

//     const remotePath = `/public_html/UserData/Invoices/UploadInvoice/${remoteFileName}`;
//     console.log(" Deleting remote file from FTP:", remotePath);
//     await client.remove(remotePath);
//     console.log(" Successfully deleted from remote UploadInvoice folder");
//   } catch (err) {
//     console.error(" Remote FTP Delete Failed:", err.message);
//   } finally {
//     client.close();
//   }
// }

module.exports = { uploadToFtp };
