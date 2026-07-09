// utils/mailer_smtp.js
import nodemailer from 'nodemailer';
import { ENV } from '../config/env.js';

const host = process.env.BREVO_SMTP_HOST || ENV.BREVO_SMTP_HOST;
const port = Number(process.env.BREVO_SMTP_PORT || ENV.BREVO_SMTP_PORT || 587);
const user = process.env.BREVO_SMTP_USER || ENV.BREVO_SMTP_USER;
const pass = process.env.BREVO_SMTP_PASS || ENV.BREVO_SMTP_PASS;
const from = process.env.BREVO_SMTP_FROM || ENV.BREVO_SMTP_FROM || user || 'no-reply@eternal-essence.com';

let transporter;
export async function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined
  });
  await transporter.verify();
  return transporter;
}

export async function sendOtpEmail({ to, code, purpose = 'signup', name }) {
  const transporter = await getTransporter();
  const subject = purpose === 'reset' ? 'Password reset OTP' : 'Your verification code';
  const html = `<div><h3>${subject}</h3><p>Your code: <strong>${code}</strong></p></div>`;
  const info = await transporter.sendMail({ from, to, subject, html });
  return { success: true, info };
}

export async function sendTestEmail(to) {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({ from, to, subject: 'Test', text: 'test' });
  return { success: true, info };
}
