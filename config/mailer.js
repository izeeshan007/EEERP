
// config/mailer.js
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

let transporter = null;

if (!EMAIL_USER || !EMAIL_PASS) {
  console.warn('⚠️ Mailer not configured (EMAIL_USER / EMAIL_PASS missing).');
} else {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    }
  });
}

export async function sendOtpEmail(toEmail, name, otp) {
  if (!transporter) {
    console.warn('⚠️ Skipping OTP email: transporter not initialized.');
    return;
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #eee;padding:20px;">
      <h2 style="text-align:center;color:#222;">Eternal Essence</h2>
      <p>Hi ${name || 'there'},</p>
      <p>Thank you for creating an account with <strong>Eternal Essence</strong>.</p>
      <p>Your verification OTP is:</p>
      <p style="font-size:32px;font-weight:bold;text-align:center;letter-spacing:4px;">${otp}</p>
      <p>This OTP is valid for 10 minutes. If you did not request this, you can ignore this email.</p>
      <br/>
      <p style="font-size:12px;color:#888;">Byculla, Mumbai • Essence, Redefined.</p>
    </div>
  `;

  await transporter.sendMail({
    from: `"Eternal Essence" <${EMAIL_USER}>`,
    to: toEmail,
    subject: 'Your Eternal Essence Verification OTP',
    html
  });
}
