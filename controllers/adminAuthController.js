// controllers/adminAuthController.js
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';
const TOKEN_TTL = process.env.ADMIN_TOKEN_TTL || '7d';

export async function adminLoginHandler(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password required' });

    const adminEmail = (process.env.ADMIN_EMAIL || '').trim();
    const adminPassword = (process.env.ADMIN_PASSWORD || '').trim();

    // Basic check — ensure env is set
    if (!adminEmail || !adminPassword) {
      console.warn('Admin login attempted but ADMIN_EMAIL or ADMIN_PASSWORD not set in env');
      return res.status(500).json({ success: false, error: 'Server not configured for admin login' });
    }

    if (email.trim().toLowerCase() !== adminEmail.toLowerCase() || password !== adminPassword) {
      // keep response generic
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // issue a token with admin claims
    const payload = { email: adminEmail, isAdmin: true, role: 'admin' };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });

    return res.json({ success: true, token, admin: { email: adminEmail } });
  } catch (err) {
    console.error('adminLoginHandler error', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
}
