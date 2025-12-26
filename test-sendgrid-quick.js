// test-sendgrid-quick.js
require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('🔧 Testing SendGrid Config...');
console.log('Host:', process.env.SMTP_HOST);
console.log('User:', process.env.SMTP_USER);
console.log('Pass starts with SG?:', process.env.SMTP_PASS?.startsWith('SG.'));

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false, 
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

transporter.sendMail({
  from: '"Test" <rudrapratapyadav141@gmail.com>',
  to: 'rudrapratapyadav141@gmail.com',
  subject: 'SendGrid Test',
  text: 'Testing...'
})
.then(() => console.log('✅ Test email sent! Check inbox.'))
.catch(err => console.log('❌ Error:', err.message));