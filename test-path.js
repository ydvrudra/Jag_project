// test-ftp-connection.js
require('dotenv').config();
const ftp = require('basic-ftp');

async function test() {
  const client = new ftp.Client();
  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      secure: false,
    });
    console.log('✅ FTP Connected');
    
    const list = await client.list('/public_html/UserData/Invoices/UploadInvoice/');
    console.log('📁 Files available:', list.map(f => f.name));
    
  } catch (err) {
    console.error('❌ FTP Error:', err.message);
  } finally {
    client.close();
  }
}

test();