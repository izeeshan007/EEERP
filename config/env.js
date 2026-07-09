// config/env.js
import dotenv from "dotenv";
dotenv.config();

const ENV = {
  PORT: process.env.PORT || 5000,
  FRONTEND_URL: process.env.FRONTEND_URL || "",
  MONGODB_URI: process.env.MONGODB_URI || "",
  JWT_SECRET: process.env.JWT_SECRET || "",
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || "",
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || "",

  // Brevo API (preferred)
  BREVO_API_KEY: process.env.BREVO_API_KEY || "",

  // SMTP fallback (optional)
  SMTP_HOST: process.env.SMTP_HOST || "",
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",
  SMTP_FROM: process.env.SMTP_FROM || "",
};

export function isSmtpConfigured() {
  return !!(
    process.env.BREVO_API_KEY ||
    (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  );
}

export function isJwtConfigured() {
  return !!ENV.JWT_SECRET;
}

export { ENV };
