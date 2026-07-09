// controllers/authController.js
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Otp from '../models/Otp.js';
import { sendOtpEmail } from '../utils/mailer.js';
import { ENV } from '../config/env.js';

const OTP_TTL_MINUTES = 10;
const RESET_TOKEN_TTL_MINUTES = 15;
const JWT_SECRET = process.env.JWT_SECRET || ENV.JWT_SECRET || 'devsecret';

/* ---------- helpers ---------- */
function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function signJwt(payload, expiresIn = '30d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

async function upsertOtp(email, purpose, code = null) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000);
  const otp = code || generateOtpCode();
  await Otp.findOneAndUpdate(
    { email: email.toLowerCase(), purpose },
    { code: otp, createdAt: now, expiresAt, attempts: 0 },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return otp;
}

/* ========== SEND OTP (generic: signup, guest, reset) ========== */
export async function sendOtpHandler(req, res) {
  try {
    const { email, phone, purpose = 'signup', name } = req.body || {};
    if (!email) return res.status(400).json({ success: false, error: 'Email is required.' });

    const normalized = email.toLowerCase().trim();
    const code = await upsertOtp(normalized, purpose);

    // Prefer specialised helper (sendOtpEmail) which builds message for OTPs
    try {
      const info = await sendOtpEmail({ to: normalized, code, purpose, name, phone });
      return res.json({ success: true, message: `OTP sent to ${normalized}`, info: info?.messageId ? { messageId: info.messageId } : {} });
    } catch (err) {
      console.error('sendOtpHandler: mail send failed', err && err.message ? err.message : err);
      return res.status(500).json({ success: false, error: 'Failed to send OTP email (SMTP error).' });
    }
  } catch (err) {
    console.error('sendOtpHandler error', err);
    return res.status(500).json({ success: false, error: 'Server error while sending OTP.' });
  }
}

/* ========== SEND RESET OTP ========== */
export async function sendResetOtpHandler(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ success: false, error: 'Email is required.' });

    const normalized = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalized });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const code = await upsertOtp(normalized, 'reset');

    try {
      const info = await sendOtpEmail({ to: normalized, code, purpose: 'reset', name: user.name });
      return res.json({ success: true, message: `Reset OTP sent to ${normalized}`, info: info?.messageId ? { messageId: info.messageId } : {} });
    } catch (err) {
      console.error('sendResetOtpHandler: mail send failed', err && err.message ? err.message : err);
      return res.status(500).json({ success: false, error: 'Failed to send reset OTP (SMTP error).' });
    }
  } catch (err) {
    console.error('sendResetOtpHandler error', err);
    return res.status(500).json({ success: false, error: 'Server error while sending reset OTP.' });
  }
}

/* ========== VERIFY OTP (signup / guest / reset) ========== */
export async function verifyOtpHandler(req, res) {
  try {
    const { email, otp, purpose = 'signup', name } = req.body || {};
    if (!email || !otp) return res.status(400).json({ success: false, error: 'Email and OTP are required.' });

    const normalized = email.toLowerCase().trim();
    const record = await Otp.findOne({ email: normalized, purpose });
    if (!record) return res.status(400).json({ success: false, error: 'OTP not generated.' });

    if (new Date() > new Date(record.expiresAt)) {
      await Otp.deleteOne({ _id: record._id }).catch(()=>{});
      return res.status(400).json({ success: false, error: 'OTP expired.' });
    }

    if (String(record.code) !== String(otp).trim()) {
      await Otp.updateOne({ _id: record._id }, { $inc: { attempts: 1 } }).catch(()=>{});
      return res.status(400).json({ success: false, error: 'Invalid OTP.' });
    }

    // valid -> remove otp
    await Otp.deleteOne({ _id: record._id }).catch(()=>{});

    if (purpose === 'signup') {
  let user = await User.findOne({ email: normalized });

  if (!user) {
    user = new User({ email: normalized, name: name || '', isVerified: true });
  }

  user.isVerified = true;

  // ✅ SET PASSWORD IF PROVIDED (guest → full user)
  if (req.body.password && !user.passwordHash) {
    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(req.body.password, salt);
  }

  if (!user.name && name) user.name = name;

  await user.save();

  const token = signJwt({ id: user._id, email: user.email }, '30d');
  return res.json({
    success: true,
    message: 'OTP verified',
    token,
    user: { id: user._id, email: user.email, name: user.name, phone: user.phone, address: user.address }
  });
}


    if (purpose === 'guest') {
      let user = await User.findOne({ email: normalized });
      if (!user) {
        user = new User({ email: normalized, name: name || 'Guest', isVerified: true });
        await user.save();
      }
      const token = signJwt({ id: user._1d, email: user.email, guest: true }, '7d');
      return res.json({ success: true, message: 'Guest verified', token, user: { id: user._id, email: user.email, name: user.name, phone: user.phone, address: user.address } });
    }

    if (purpose === 'reset') {
      const user = await User.findOne({ email: normalized });
      if (!user) return res.status(404).json({ success: false, error: 'No account found for this email.' });

      const resetToken = signJwt({ id: user._id, email: user.email, reset: true }, `${RESET_TOKEN_TTL_MINUTES}m`);
      return res.json({ success: true, message: 'OTP verified for reset', resetToken });
    }

    // fallback success
    return res.json({ success: true, message: 'OTP verified.' });
  } catch (err) {
    console.error('verifyOtpHandler error', err);
    return res.status(500).json({ success: false, error: 'Server error during OTP verification.' });
  }
}

/* ========== VERIFY RESET OTP (explicit endpoint) ========== */
export async function verifyResetOtpHandler(req, res) {
  // small wrapper keeping same behavior as verifyOtp with purpose='reset'
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) return res.status(400).json({ success: false, error: 'Email and OTP are required.' });
    // reuse logic
    return await verifyOtpHandler({ body: { email, otp, purpose: 'reset' } }, res);
  } catch (err) {
    console.error('verifyResetOtpHandler error', err);
    return res.status(500).json({ success: false, error: 'Server error.' });
  }
}

/* ========== REGISTER (with handling existing unverified user) ========== */
export async function registerHandler(req, res) {
  try {
    const { name, email, phone, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password required.' });

    const normalized = email.toLowerCase().trim();
    const existing = await User.findOne({ email: normalized });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    if (existing) {
  // ✅ Case 1: Guest user exists (no password yet)
  if (!existing.passwordHash) {
    const salt = await bcrypt.genSalt(10);
    existing.passwordHash = await bcrypt.hash(password, salt);
    if (name) existing.name = name;
    if (phone) existing.phone = phone;
    existing.isVerified = false;
    await existing.save();

    const code = await upsertOtp(normalized, 'signup');
    await sendOtpEmail({ to: normalized, code, purpose: 'signup', name });

    return res.json({
      success: true,
      message: 'Guest account found. OTP sent to complete registration.'
    });
  }

  // ❌ Case 2: Real user already exists
  if (existing.isVerified) {
    return res.status(409).json({ success: false, error: 'User already exists. Please login.' });
  }
}


    // create new unverified user
    const user = new User({ name, email: normalized, phone, passwordHash, isVerified: false });
    await user.save();

    const code = await upsertOtp(normalized, 'signup');

    try { await sendOtpEmail({ to: normalized, code, purpose: 'signup', name }); }
    catch (e) { console.warn('signup OTP mail failed', e && e.message ? e.message : e); }

    return res.json({ success: true, message: 'OTP sent to your email. Please verify to complete registration.' });
  } catch (err) {
    console.error('registerHandler error', err);
    if (String(err).includes('E11000') || String(err).includes('duplicate')) {
      return res.status(409).json({ success: false, error: 'User already exists.' });
    }
    return res.status(500).json({ success: false, error: 'Server error during registration.' });
  }
}

/* ========== LOGIN ========== */
export async function loginHandler(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password are required.' });

    const normalized = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalized }).select('+passwordHash');

    if (!user) return res.status(400).json({ success: false, error: 'Invalid credentials.' });

    if (!user.passwordHash) {
  return res.status(403).json({
    success: false,
    error: 'This account was created as guest. Please verify OTP to set password.'
  });
}

const ok = await bcrypt.compare(password, user.passwordHash);
if (!ok) {
  return res.status(400).json({ success: false, error: 'Invalid credentials.' });
}


    // normalize isVerified to boolean to avoid undefined behavior
    const verified = !!user.isVerified;
    if (!verified) return res.status(403).json({ success: false, error: 'Account not verified. Please verify using OTP.' });

    const token = signJwt({ id: user._id, email: user.email }, '30d');
    return res.json({ success: true, token, user: { id: user._id, email: user.email, name: user.name, phone: user.phone, address: user.address } });
  } catch (err) {
    console.error('loginHandler error', err);
    return res.status(500).json({ success: false, error: 'Server error during login.' });
  }
}

/* ========== FORGOT PASSWORD (send OTP) ========== */
export async function forgotPasswordHandler(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ success: false, error: 'Email is required.' });

    const normalized = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalized });
    if (!user) return res.status(404).json({ success: false, error: 'No account found for this email.' });

    const code = await upsertOtp(normalized, 'reset');

    try { await sendOtpEmail({ to: normalized, code, purpose: 'reset', name: user.name }); }
    catch (e) { console.warn('forgot pwd mail failed', e && e.message ? e.message : e); }

    return res.json({ success: true, message: `OTP sent to ${normalized}` });
  } catch (err) {
    console.error('forgotPasswordHandler error', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
}

/* ========== RESET PASSWORD (requires resetToken from verify OTP purpose=reset) ========== */
export async function resetPasswordHandler(req, res) {
  try {
    const { email, resetToken, newPassword } = req.body || {};
    if (!email || !resetToken || !newPassword) return res.status(400).json({ success: false, error: 'Missing parameters.' });

    try {
      const payload = jwt.verify(resetToken, JWT_SECRET);
      if (!payload || !payload.reset || payload.email !== email.toLowerCase()) {
        return res.status(400).json({ success: false, error: 'Invalid reset token.' });
      }
    } catch (err) {
      return res.status(400).json({ success: false, error: 'Reset token invalid or expired.' });
    }

    const normalized = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalized }).select('+passwordHash');
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    user.passwordHash = passwordHash;
    await user.save();

    return res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('resetPasswordHandler error', err);
    return res.status(500).json({ success: false, error: 'Server error updating password.' });
  }
}

/* ========== PROFILE & HELPERS ========== */
export async function getProfileHandler(req, res) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s*/i, '').trim();
    if (!token) return res.status(401).json({ success: false, error: 'Missing token.' });

    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch (e) { return res.status(401).json({ success: false, error: 'Invalid token.' }); }

    const user = await User.findById(payload.id).select('-passwordHash');
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    return res.json({ success: true, user });
  } catch (err) {
    console.error('getProfileHandler error', err);
    return res.status(500).json({ success: false, error: 'Server error.' });
  }
}

export async function updateProfileHandler(req, res) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s*/i, '').trim();
    if (!token) return res.status(401).json({ success: false, error: 'Missing token.' });

    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch (e) { return res.status(401).json({ success: false, error: 'Invalid token.' }); }

    const { name, phone, address } = req.body || {};
    const user = await User.findById(payload.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    if (typeof name === 'string') user.name = name;
    if (typeof phone === 'string') user.phone = phone;
    if (address && typeof address === 'object') {
      user.address = {
        name: address.name || user.address?.name || '',
        phone: address.phone || user.address?.phone || '',
        addressLine: address.addressLine || user.address?.addressLine || '',
        city: address.city || user.address?.city || '',
        pincode: address.pincode || user.address?.pincode || '',
        state: address.state || user.address?.state || ''
      };
    }

    await user.save();
    return res.json({ success: true, user: { id: user._id, email: user.email, name: user.name, phone: user.phone, address: user.address } });
  } catch (err) {
    console.error('updateProfileHandler error', err);
    return res.status(500).json({ success: false, error: 'Server error.' });
  }
}

/* ========== WISHLIST HANDLERS ========== */
function extractUserIdFromAuthHeader(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = String(authHeader).replace(/^Bearer\s*/i, '').trim();
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload?.id || null;
  } catch (e) {
    return null;
  }
}

export async function getWishlistHandler(req, res) {
  try {
    const userId = (req.user && req.user.id) || extractUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const user = await User.findById(userId).select('wishlist email name');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    return res.json({ success: true, wishlist: user.wishlist || [], user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('getWishlistHandler error', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
}

export async function addToWishlistHandler(req, res) {
  try {
    const userId = (req.user && req.user.id) || extractUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { productId } = req.body || {};
    if (typeof productId === 'undefined' || productId === null) return res.status(400).json({ success: false, error: 'productId required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const pid = Number(productId);
    user.wishlist = Array.isArray(user.wishlist) ? user.wishlist.map(Number) : [];
    if (!user.wishlist.includes(pid)) user.wishlist.push(pid);

    await user.save();
    return res.json({ success: true, message: 'Added to wishlist', wishlist: user.wishlist });
  } catch (err) {
    console.error('addToWishlistHandler error', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
}

export async function removeFromWishlistHandler(req, res) {
  try {
    const userId = (req.user && req.user.id) || extractUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const productId = req.params.productId || req.body.productId;
    if (typeof productId === 'undefined' || productId === null) return res.status(400).json({ success: false, error: 'productId required' });

    const pid = Number(productId);
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    user.wishlist = (user.wishlist || []).map(Number).filter(x => x !== pid);
    await user.save();
    return res.json({ success: true, message: 'Removed from wishlist', wishlist: user.wishlist });
  } catch (err) {
    console.error('removeFromWishlistHandler error', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
}

