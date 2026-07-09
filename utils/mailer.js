// utils/mailer.js
import nodemailer from 'nodemailer';
import { ENV } from '../config/env.js';

// NOTE: Node 18+ provides global fetch; if your Node doesn't, install node-fetch.
// This file prefers Brevo REST API when BREVO_API_KEY is present, otherwise uses SMTP.

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const SMTP_HOST = process.env.BREVO_SMTP_HOST || process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.BREVO_SMTP_PORT || process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.BREVO_SMTP_USER || process.env.SMTP_USER || '';
const SMTP_PASS = process.env.BREVO_SMTP_PASS || process.env.SMTP_PASS || '';
const DEFAULT_FROM = process.env.BREVO_SMTP_FROM || process.env.SMTP_FROM || ENV.SMTP_FROM || SMTP_USER || 'no-reply@example.com';

let _smtpTransporter = null;
async function getSmtpTransporter() {
  if (_smtpTransporter) return _smtpTransporter;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) throw new Error('SMTP not configured');
  _smtpTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: String(SMTP_PORT) === '465',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  // verify (non-fatal)
  try { await _smtpTransporter.verify(); } catch (e) { /* ignore here; callers will see send errors */ }
  return _smtpTransporter;
}

/**
 * sendTransactionalEmail: sends email using Brevo REST API if available,
 * otherwise falls back to SMTP via nodemailer.
 *
 * opts: { to, subject, html, text, from }
 */
export async function sendTransactionalEmail(opts = {}) {
  const to = opts.to;
  if (!to) throw new Error('Missing "to"');
  const subject = opts.subject || '(no subject)';
  const html = opts.html || opts.body || '';
  const text = opts.text || (html ? html.replace(/<[^>]+>/g, '') : '');
  const from = opts.from || DEFAULT_FROM;

  // 1) Brevo REST API (preferred)
  if (BREVO_API_KEY) {
    try {
      const payload = {
        sender: { name: from.includes('<') ? from.split('<')[0].trim() : 'Eternal Essence', email: (from.match(/<(.+)>/) || [])[1] || from.replace(/".*"/, '').trim() },
        to: Array.isArray(to) ? to.map(t => ({ email: t })) : [{ email: String(to).trim() }],
        subject,
        htmlContent: html,
        textContent: text
      };

      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'accept': 'application/json',
          'api-key': BREVO_API_KEY
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = data?.message || data?.error || `Brevo API responded ${res.status}`;
        throw new Error(errMsg);
      }
      // Brevo returns messageId etc.
      return { success: true, provider: 'brevo', info: data };
    } catch (err) {
      // bubble up so callers can know Brevo failed and optionally fallback if desired
      throw new Error('Brevo send failed: ' + (err.message || err));
    }
  }

  // 2) SMTP fallback
  try {
    const transporter = await getSmtpTransporter();
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
      text
    });
    return { success: true, provider: 'smtp', info };
  } catch (err) {
    throw new Error('SMTP send failed: ' + (err.message || err));
  }
}

/**
 * sendMail alias for back-compat (some of your imports expected sendMail)
 */
export const sendMail = sendTransactionalEmail;

/**
 * sendOtpEmail helper (builds OTP message)
 * opts: { to, code, purpose, name, phone }
 */
export async function sendOtpEmail({ to, code, purpose = 'signup', name = '', phone = '' } = {}) {
  if (!to || !code) throw new Error('Missing to/code for OTP email');

  const subject = purpose === 'reset' ? 'Your password reset code' : 'Your verification code';
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color:#111; line-height:1.4;">
      <h2 style="margin:0 0 8px 0;">Eternal Essence</h2>
      <p style="margin:0 0 6px 0;">Hello ${name || ''},</p>
      <p style="margin:6px 0;">Your ${purpose === 'reset' ? 'password reset' : 'verification'} code is:</p>
      <div style="font-size:22px; font-weight:700; margin:8px 0;">${code}</div>
      <p style="margin:6px 0;">This code will expire in 10 minutes.</p>
      <p style="margin:12px 0 0 0; font-size:12px; color:#666">If you didn't request this, please ignore.</p>
    </div>
  `;

  // Let sendTransactionalEmail throw if it fails
  return await sendTransactionalEmail({ to, subject, html, from: DEFAULT_FROM });
}

/**
 * sendTestEmail(to)
 */
export async function sendTestEmail(to) {
  const html = `<p>This is a test email from Eternal Essence backend — ${new Date().toISOString()}</p>`;
  return await sendTransactionalEmail({ to, subject: 'Eternal Essence - Test Email', html, from: DEFAULT_FROM });
}
