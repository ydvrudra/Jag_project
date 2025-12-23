// // services/scraperService.js
// const { pool, sql } = require('../config/sqlConfig'); // ADD THIS
// const path = require("path");
// const { uploadDir } = require("../config/constants");

// exports.scrapePdfLinks = async () => {
//   try {
//     // 1. Database se latest filenames fetch karo
//     const result = await pool.request().query(`
//       SELECT UploadInvoice 
//       FROM InvoiceuploadHdr 
//       WHERE InvoiceuploadHdrId = (SELECT MAX(InvoiceuploadHdrId) FROM InvoiceuploadHdr)
//     `);
    
//     const fileString = result.recordset[0]?.UploadInvoice || '';
//     if (!fileString) return [];
    
//     // 2. Comma separated se array banao
//     const pdfFiles = fileString.split(',')
//       .map(f => f.trim())
//       .filter(f => f && f.toLowerCase().endsWith('.pdf'));
    
//     console.log('Files from database:', pdfFiles);
    
//     // 3. PDF links prepare karo
//     const pdfLinks = [];
//     const baseUrl = process.env.INVOICE_BASE_URL || 'http://study.jagsoftware.in/public_html/UserData/Invoices/UploadInvoice/';
    
//     for (const fileName of pdfFiles) {
//       const fullUrl = baseUrl + fileName;
//       const localPath = path.join(uploadDir, fileName);
//       pdfLinks.push({ fullUrl, fileName, localPath });
//     }
    
//     return pdfLinks;
    
//   } catch (err) {
//     console.error('Database fetch error:', err.message);
//     return [];
//   }
// };