// routes/productRoutes.js
import express from 'express';
import Product from '../models/Product.js';
import BundleRule from '../models/BundleRule.js';

const router = express.Router();

router.get('/bundle-rules', async (req, res) => {
  try {
    const rules = await BundleRule.find({ isActive: true }).sort({ sizeMl: 1, setQty: 1 });
    res.json({ success: true, rules });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load bundle rules' });
  }
});

/**
 * PUBLIC PRODUCTS
 * Visible on website (no auth)
 */
router.get('/', async (req, res) => {
  try {
    const products = await Product.find({ isActive: true })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      products
    });
  } catch (err) {
    console.error('Public products error', err);
    res.status(500).json({
      success: false,
      error: 'Failed to load products'
    });
  }
});

export default router;
