// routes/admin.js
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';

import { requireAdmin } from '../middleware/adminAuth.js';
import * as adminCtrl from '../controllers/adminController.js';
import {
  createProduct,
  getAllProductsAdmin,
  updateProduct,
  deleteProduct
} from '../controllers/adminProductController.js';

const router = express.Router();

/* ================= CONFIG ================= */

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();

if (!JWT_SECRET || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.warn('⚠️ ADMIN ENV NOT FULLY CONFIGURED');
}

/* ================= ADMIN LOGIN ================= */
router.post('/login', async (req, res) => {
  try {
    const { email = '', password = '' } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password required'
      });
    }

    const normalized = email.trim().toLowerCase();

    /* ===== ENV ADMIN LOGIN (PRIMARY) ===== */
    if (normalized === ADMIN_EMAIL) {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
      }

      const token = jwt.sign(
        { email: ADMIN_EMAIL, isAdmin: true },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      return res.json({
        success: true,
        token,
        email: ADMIN_EMAIL
      });
    }

    /* ===== DATABASE ADMIN LOGIN (OPTIONAL) ===== */
    const user = await User.findOne({ email: normalized })
      .select('+passwordHash isAdmin isVerified');

    if (!user || !user.isAdmin || !user.isVerified) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const token = jwt.sign(
      { email: normalized, isAdmin: true, id: user._id },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.json({
      success: true,
      token,
      email: normalized
    });

  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

/* ================= PRODUCTS ================= */
router.get('/products', requireAdmin, getAllProductsAdmin);
router.post('/products', requireAdmin, createProduct);
router.put('/products/:id', requireAdmin, updateProduct);
router.delete('/products/:id', requireAdmin, deleteProduct);

/* ================= ORDERS ================= */
router.get('/orders', requireAdmin, adminCtrl.getOrders);
router.get('/orders/:id', requireAdmin, adminCtrl.getOrderById);
router.put('/orders/:id', requireAdmin, adminCtrl.updateOrderStatus);
router.put('/orders/:id/cancel', requireAdmin, adminCtrl.cancelOrder);
router.delete('/orders/:id', requireAdmin, adminCtrl.deleteOrder);

/* ================= DASHBOARD ================= */
router.get('/dashboard', requireAdmin, adminCtrl.getDashboard);

/* ================= COUPONS ================= */
router.get('/coupons', requireAdmin, adminCtrl.getCoupons);
router.post('/coupons', requireAdmin, adminCtrl.createCoupon);
router.delete('/coupons/:id', requireAdmin, adminCtrl.deleteCoupon);

/* ================= CUSTOM SET RULES ================= */
router.get('/bundle-rules', requireAdmin, adminCtrl.getBundleRules);
router.post('/bundle-rules', requireAdmin, adminCtrl.upsertBundleRule);
router.delete('/bundle-rules/:id', requireAdmin, adminCtrl.deleteBundleRule);

/* ================= USERS ================= */
router.get('/users', requireAdmin, adminCtrl.getUsers);

export default router;
