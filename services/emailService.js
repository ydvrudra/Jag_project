const nodemailer = require("nodemailer");
const fs = require("fs");

async function sendInvoiceProcessingSummaryEmail({ 
  successCount, 
  failCount, 
  successFiles, 
  failFiles, 
  skippedFiles,  
  attachmentPath, 
  toEmail 
}) {
  try {
   // console.log("📧 Preparing email...");
    
    // Transporter setup
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT) || 465,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    // Verify connection
    await transporter.verify();
  //  console.log("✅ SMTP connection verified");

    // Prepare HTML content for failed files
    let failFilesHTML = '';
    if (failCount > 0) {
      failFilesHTML = `
        <div style="background: #ffebee; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <h3 style="color: #c62828; margin-top: 0;">❌ Failed to Process: ${failCount} invoice(s)</h3>
          <ul style="margin: 10px 0;">
            ${failFiles.map(f => {
              if (typeof f === 'string') {
                return `<li><strong>${f}</strong></li>`;
              } else if (f && f.fileName) {
                return `<li><strong>${f.fileName}</strong> - Error: ${f.error || 'Unknown error'}</li>`;
              }
              return `<li>Unknown file</li>`;
            }).join("")}
          </ul>
        </div>
      `;
    }

    // 🟢 NAYA: Prepare HTML content for SKIPPED files
    let skippedFilesHTML = '';
    if (skippedFiles && Array.isArray(skippedFiles) && skippedFiles.length > 0) {
      skippedFilesHTML = `
        <div style="background: #fff3e0; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #ff9800;">
          <h3 style="color: #ef6c00; margin-top: 0;">💰 Already Processed (Skipped): ${skippedFiles.length} invoice(s)</h3>
          <p style="color: #ef6c00; margin-bottom: 10px; font-style: italic;">
            These invoices were already processed earlier and were skipped to avoid duplicate charges.
          </p>
          <ul style="margin: 10px 0;">
            ${skippedFiles.map(f => `<li><strong>${f.filename || f.fileName || f}</strong></li>`).join("")}
          </ul>
          <p style="margin-top: 10px; font-size: 12px; color: #ef6c00;">
            <strong>💰 Cost Saving:</strong> Skipped invoices do not incur any Azure processing charges.
          </p>
        </div>
      `;
    }

    // Mail options
    const mailOptions = {
      from: `"Invoice Processing System" <${process.env.SMTP_USER}>`,
      to: toEmail || process.env.DEFAULT_EMAIL,
      subject: `Invoice Processing Report - ${new Date().toLocaleDateString()}`,
      html: `
        <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; max-width: 600px; margin: 0 auto;">
          <div style="background: #004aad; color: white; padding: 20px; border-radius: 5px 5px 0 0;">
            <h2 style="margin: 0;">📊 Invoice Processing Summary</h2>
          </div>
          
          <div style="padding: 20px; background: #f9f9f9; border: 1px solid #ddd;">
            <p>Dear User,</p>
            <p>The automated invoice processing has been completed. Below is the summary:</p>
            
            <!-- Success Section -->
            <div style="background: #e7f7e7; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <h3 style="color: #2e7d32; margin-top: 0;">✅ Successfully Processed: ${successCount} invoice(s)</h3>
              ${successCount > 0 ? 
                '<ul style="margin: 10px 0;">' + successFiles.map(f => '<li><strong>' + f + '</strong></li>').join("") + '</ul>' : 
                '<p>No invoices were successfully processed.</p>'}
            </div>
            
            <!-- 🟢 NAYA: Skipped Section -->
            ${skippedFilesHTML}
            
            <!-- Failed Section -->
            ${failFilesHTML}
            
            ${attachmentPath && fs.existsSync(attachmentPath) ? 
              '<p style="margin-top: 20px;"><strong>📎 Attachment:</strong> Detailed Excel report is attached with this email.</p>' : 
              ''}
            
            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
            
            <p>
              <strong>Processing Time:</strong> ${new Date().toLocaleString()}<br>
              <strong>Total Files Attempted:</strong> ${successCount + failCount + (skippedFiles ? skippedFiles.length : 0)}<br>
              <strong>Total Files Skipped:</strong> ${skippedFiles ? skippedFiles.length : 0}
            </p>
            
            <p>Regards,<br><strong>Invoice Processing System</strong><br>Jag Software</p>
          </div>
          
          <div style="background: #f5f5f5; padding: 10px; text-align: center; font-size: 12px; color: #777; border-radius: 0 0 5px 5px;">
            <p>This is an automated email. Please do not reply.</p>
          </div>
        </div>
      `,
    };

    // Add attachment if exists
    if (attachmentPath && fs.existsSync(attachmentPath)) {
      const stats = fs.statSync(attachmentPath);
      if (stats.size > 0) {
        mailOptions.attachments = [{
          filename: `Invoice_Report_${new Date().toISOString().split('T')[0]}.xlsx`,
          path: attachmentPath,
        }];
        //console.log(`✅ Attachment added: ${stats.size} bytes`);
      } else {
       // console.log(`⚠️ Attachment file is empty`);
      }
    }

    // Send email
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully!`);
    
    return { success: true, messageId: info.messageId };
    
  } catch (error) {
    console.error("❌ Email sending failed:", error.message);
    
    if (error.code === 'EAUTH') {
    //  console.error("🔐 Authentication failed. Check SMTP credentials.");
    } else if (error.code === 'ECONNECTION') {
     // console.error("🌐 Connection failed.");
    }
    
    throw error;
  }
}

module.exports = { sendInvoiceProcessingSummaryEmail };