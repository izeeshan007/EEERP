// config/mail.js
import nodemailer from 'nodemailer';
import { ENV } from './env.js';

const BREVO_SMTP_HOST = process.env.BREVO_SMTP_HOST || ENV.BREVO_SMTP_HOST || '';
const BREVO_SMTP_PORT = Number(process.env.BREVO_SMTP_PORT || ENV.BREVO_SMTP_PORT || 587);
const BREVO_SMTP_USER = process.env.BREVO_SMTP_USER || ENV.BREVO_SMTP_USER || '';
const BREVO_SMTP_PASS = process.env.BREVO_SMTP_PASS || ENV.BREVO_SMTP_PASS || '';

export async function getTransporter() {
  if (!BREVO_SMTP_HOST || !BREVO_SMTP_USER || !BREVO_SMTP_PASS) {
    throw new Error('SMTP not configured');
  }
  const transporter = nodemailer.createTransport({
    host: BREVO_SMTP_HOST,
    port: BREVO_SMTP_PORT,
    secure: String(BREVO_SMTP_PORT) === '465',
    auth: { user: BREVO_SMTP_USER, pass: BREVO_SMTP_PASS }
  });

  // verify on creation (promise)
  await transporter.verify();
  return transporter;
}
