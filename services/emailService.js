const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");

async function sendInvoiceProcessingSummaryEmail({ successCount, failCount,successFiles,failFiles, attachmentPath, toEmail }) {
  // 1. Transporter setup (SMTP ya Gmail)
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  // 2. Mail content
  const mailOptions = {
    from: `"Invoice Processing System" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: "Invoice Processing Summary Report",
    html: `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        <h2 style="color: #004aad;">Invoice Processing Completed Successfully</h2>
        <p>Dear User,</p>
        <p>The invoice processing task has been completed. Please find below the summary:</p>
           <p><strong>✅ Successfully Processed Invoices:</strong> ${successCount} invoices</p>
           <ul>
          ${successFiles.map(f => `<li><strong>${f}</strong></li>`).join("")}
          </ul>
          
          <p><strong>❌ Failed Invoices:</strong> ${failCount} invoices</p>

        ${failCount > 0 ? `
          <p>The following invoices failed to process:</p>
           <ul>
           ${failFiles.map(f => `<li><strong>${f.fileName}</strong> - Error: ${f.error}</li>`).join("")}
          </ul>
        ` : `
          <p>All invoices were processed successfully.</p>
        `}
        <p>Please find the attached Excel report for detailed information.</p>
        <br/>
        <p>Regards,<br/>Jag Software Team</p>
      </div>
    `,
  };

  // 3. Attach file if exists
  if (attachmentPath && fs.existsSync(attachmentPath)) {
    mailOptions.attachments = [
      {
        filename: path.basename(attachmentPath),
        path: attachmentPath,
      },
    ];
  }

  // 4. Send mail
  await transporter.sendMail(mailOptions);
  console.log("Summary email sent successfully!");
}

module.exports = { sendInvoiceProcessingSummaryEmail };
