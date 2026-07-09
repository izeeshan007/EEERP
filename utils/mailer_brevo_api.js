// utils/mailer_brevo_api.js
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * sendViaBrevoApi({ to, subject, text, html, from })
 * - requires process.env.BREVO_API_KEY (Brevo SMTP API Key)
 */
export async function sendViaBrevoApi({ to, subject, text, html, from }) {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY not configured');
  }

  // Normalize recipients
  const recipients = Array.isArray(to) ? to.map(t => ({ email: t })) : [{ email: to }];
  const senderEmail = (from || process.env.BREVO_SMTP_FROM || process.env.SMTP_FROM || process.env.BREVO_SMTP_USER || process.env.SMTP_USER || '').replace(/.*<(.+)>/, '$1');

  const payload = {
    sender: { email: senderEmail || process.env.BREVO_SMTP_USER || process.env.SMTP_USER, name: undefined },
    to: recipients,
    subject: subject || 'Eternal Essence',
    htmlContent: html || undefined,
    textContent: text || undefined
  };

  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.BREVO_API_KEY
    },
    body: JSON.stringify(payload)
  });

  const textBody = await res.text();
  if (!res.ok) {
    const parsed = (() => { try { return JSON.parse(textBody); } catch(e){ return { raw: textBody }; } })();
    const msg = parsed.message || parsed || textBody;
    const err = new Error('Brevo API error: ' + (msg || `status ${res.status}`));
    err.status = res.status;
    err.body = parsed;
    throw err;
  }

  return { success: true, raw: (() => { try { return JSON.parse(textBody); } catch(e){ return textBody; } })() };
}
