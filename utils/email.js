// utils/email.js
import nodemailer from 'nodemailer';

const createTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!host || !port || !user || !pass) {
    console.warn('⚠️ SMTP not configured - email sending disabled.');
    return null;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports (STARTTLS)
    auth: {
      user,
      pass
    },
    tls: {
      // to avoid TLS rejection errors in some environments
      rejectUnauthorized: false
    }
  });

  return { transporter, from };
};

export async function sendOtpEmail({ to, subject = 'Your OTP', text, html }) {
  const ctx = createTransporter();
  if (!ctx) {
    throw new Error('SMTP not configured. Check SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS in .env');
  }
  const { transporter, from } = ctx;

  // verify transporter before sending (helpful for debugging)
  try {
    await transporter.verify();
  } catch (err) {
    // attach a helpful message
    err.message = `SMTP verify failed: ${err.message}`;
    throw err;
  }

  const mailOptions = {
    from,
    to,
    subject,
    text: text || html?.replace(/<[^>]+>/g, '') || 'Your OTP code',
    html: html || `<p>Your OTP code is: <strong>${text}</strong></p>`
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    // nodemailer returns `info` - useful for debugging (messageId, response)
    return { success: true, info };
  } catch (err) {
    // bubble with useful context
    err.message = `Failed to send email: ${err.message}`;
    throw err;
  }
}
