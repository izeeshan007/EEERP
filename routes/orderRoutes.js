import express from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';

import Order from '../models/Order.js';
import Coupon from '../models/Coupon.js';
import authMiddleware from '../middleware/auth.js';
import { generateOrderId } from '../utils/orderIdGenerator.js';

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

/* ================= VALIDATE COUPON ================= */
router.post('/validate-coupon', async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const subtotal = Number(req.body?.subtotal || 0);

    if (!code) return res.status(400).json({ success: false, error: 'Coupon code is required' });
    if (subtotal <= 0) return res.status(400).json({ success: false, error: 'Add items before applying a coupon' });

    const coupon = await Coupon.findOne({ code, isActive: true }).lean();
    if (!coupon) return res.status(404).json({ success: false, error: 'Invalid or expired coupon' });

    if (subtotal < Number(coupon.minOrderValue || 0)) {
      return res.status(400).json({
        success: false,
        error: `Order must be at least ₹${Number(coupon.minOrderValue).toLocaleString('en-IN')} for this coupon`
      });
    }

    const discountAmount = coupon.discountType === 'percentage'
      ? Math.round(subtotal * (Number(coupon.discountValue) / 100))
      : Math.min(Number(coupon.discountValue), subtotal);

    res.json({
      success: true,
      code: coupon.code,
      discountAmount,
      coupon: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        minOrderValue: coupon.minOrderValue
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Could not validate coupon' });
  }
});

/* ================= CREATE ORDER ================= */
router.post('/create-razorpay-order', async (req, res) => {
  try {
    const { cart, subtotal, discount, shipping, total, customer, couponCode, freeGift } = req.body;

    const orderId = await generateOrderId();

    const order = await Order.create({
      orderId,
      buyerEmail: customer.email,
      name: customer.name,
      phone: customer.phone,
      shippingAddress: customer.address,
      items: cart,
      subtotal,
      discount,
      couponCode,
      freeGift,
      shipping,
      total,
      paymentMethod: 'Razorpay',
      status: 'PENDING_PAYMENT'
    });

    const rpOrder = await razorpay.orders.create({
      amount: Math.round(total * 100),
      currency: 'INR',
      receipt: order._id.toString()
    });

    order.razorpay_order_id = rpOrder.id;
    await order.save();

    res.json({
      success: true,
      keyId: process.env.RAZORPAY_KEY_ID,
      amount: rpOrder.amount,
      razorpayOrderId: rpOrder.id,
      orderId: order.orderId,
      mongoId: order._id
    });
  } catch (err) {
    console.error('create-razorpay-order error:', err);
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});

/* ================= VERIFY PAYMENT ================= */
router.post('/verify-razorpay', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    const order = await Order.findOne({ razorpay_order_id });
    if (!order) return res.status(404).json({ success: false });

    const sign = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (sign !== razorpay_signature) {
      order.status = 'PAYMENT_FAILED';
      await order.save();
      return res.status(400).json({ success: false });
    }

    order.status = 'PAID';
    order.razorpay_payment_id = razorpay_payment_id;
    order.razorpay_signature = razorpay_signature;
    await order.save();

    res.json({ success: true, orderId: order.orderId });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ================= RETRY PAYMENT ================= */
router.post('/retry/:id', authMiddleware, async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ success: false });

  if (order.status === 'PAID') {
    return res.json({ success: false, error: 'Already paid' });
  }

  const rpOrder = await razorpay.orders.create({
    amount: Math.round(order.total * 100),
    currency: 'INR',
    receipt: order._id.toString()
  });

  order.razorpay_order_id = rpOrder.id;
  await order.save();

  res.json({
    success: true,
    razorpayOrderId: rpOrder.id,
    amount: rpOrder.amount,
    keyId: process.env.RAZORPAY_KEY_ID
  });
});

/* ================= CANCEL ORDER ================= */
router.post('/cancel/:id', authMiddleware, async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.json({ success: false });

  if (['SHIPPED', 'DELIVERED'].includes(order.status)) {
    return res.json({ success: false, error: 'Already shipped' });
  }

  order.status = 'CANCELLED';
  await order.save();

  res.json({ success: true });
});

/* ================= MY ORDERS ================= */
router.get('/my', authMiddleware, async (req, res) => {
  const orders = await Order.find({ buyerEmail: req.user.email }).sort({
    createdAt: -1
  });

  res.json({ success: true, orders });
});

export default router;
