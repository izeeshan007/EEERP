import Order from '../models/Order.js';
import User from '../models/User.js';
import Coupon from '../models/Coupon.js';
import BundleRule from '../models/BundleRule.js';
import mongoose from 'mongoose';

/* ================== CONSTANTS ================== */
const COMPLETED_STATUSES = ['PAID', 'Payment Success', 'Shipped', 'Delivered'];

/**
 * Helper: resolve an order by id that might be either _id or orderId
 */
async function findOrderByIdOrOrderId(idOrOrderId) {
  if (!idOrOrderId) return null;

  if (mongoose.Types.ObjectId.isValid(idOrOrderId)) {
    const byId = await Order.findById(idOrOrderId).lean();
    if (byId) return byId;
  }

  return Order.findOne({ orderId: idOrOrderId }).lean();
}

/* ================== ORDERS ================== */
export async function getOrders(req, res) {
  try {
    const q = (req.query.q || '').trim();
    const status = (req.query.status || '').trim();
    const limit = Math.min(200, Number(req.query.limit) || 200);
    const { startDate, endDate } = req.query;

    const filter = {};

    /* ===== STATUS ===== */
    if (status) {
      filter.status = status;
    }

    /* ===== SEARCH ===== */
    if (q) {
      filter.$or = [
        { orderId: { $regex: q, $options: 'i' } },
        { buyerEmail: { $regex: q, $options: 'i' } },
        { name: { $regex: q, $options: 'i' } }
      ];
    }

    /* ===== DATE FILTER ===== */
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate + 'T23:59:59');
    }

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, orders });

  } catch (err) {
    console.error('getOrders error', err);
    res.status(500).json({
      success: false,
      error: 'Server error fetching orders'
    });
  }
}


export async function getOrderById(req, res) {
  try {
    const order = await findOrderByIdOrOrderId(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
}

/* ================== DASHBOARD ================== */
export async function getDashboard(req, res) {
  try {
    const { startDate, endDate } = req.query;

    const COMPLETED = COMPLETED_STATUSES;

    const from = startDate
      ? new Date(startDate)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const to = endDate ? new Date(endDate) : new Date();

    /* ================= REVENUE (SHIPPED + DELIVERED) ================= */
    const completedOrders = await Order.find({
      createdAt: { $gte: from, $lte: to },
      status: { $in: COMPLETED }
    }).lean();

    const revenue = completedOrders.reduce(
      (sum, o) => sum + Number(o.total || 0),
      0
    );

    /* ================= AVG ORDER VALUE (LAST 30 DAYS) ================= */
    const days30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const recentCompleted = await Order.find({
      createdAt: { $gte: days30 },
      status: { $in: COMPLETED }
    }).lean();

    const avgOrderValue = recentCompleted.length
      ? Math.round(
          recentCompleted.reduce((s, o) => s + Number(o.total || 0), 0) /
            recentCompleted.length
        )
      : 0;

    /* ================= COUNTS ================= */
    const pendingCount = await Order.countDocuments({
      status: { $in: ['PENDING_PAYMENT', 'Pending', 'Processing'] }
    });

    const deliveredCount = await Order.countDocuments({
      status: 'Delivered'
    });

    /* ================= SALES BY MONTH (DATE FILTERED) ================= */
    const salesByMonth = await Order.aggregate([
      {
        $match: {
          status: { $in: COMPLETED },
          createdAt: { $gte: from, $lte: to }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          total: { $sum: { $toDouble: '$total' } }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const monthly = salesByMonth.map(m => ({
      label: `${m._id.month}/${m._id.year}`,
      total: m.total
    }));

    /* ================= STATUS BREAKDOWN ================= */
    const statusAgg = await Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const ordersByStatus = {};
    statusAgg.forEach(s => {
      ordersByStatus[s._id] = s.count;
    });

    const topProducts = await Order.aggregate([
      {
        $match: {
          status: { $in: COMPLETED },
          createdAt: { $gte: from, $lte: to }
        }
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.name',
          totalSold: { $sum: 1 },
          revenue: { $sum: { $toDouble: '$items.price' } }
        }
      },
      { $sort: { totalSold: -1, revenue: -1 } },
      { $limit: 10 }
    ]);

    const salesByState = await Order.aggregate([
      {
        $match: {
          status: { $in: COMPLETED },
          createdAt: { $gte: from, $lte: to }
        }
      },
      {
        $group: {
          _id: {
            $ifNull: [
              { $arrayElemAt: [{ $split: ['$shippingAddress', ','] }, -1] },
              'Unknown'
            ]
          },
          total: { $sum: { $toDouble: '$total' } }
        }
      },
      { $sort: { total: -1 } },
      { $limit: 10 }
    ]);

    return res.json({
      success: true,
      monthlySales: revenue,
      monthlyOrders: completedOrders.length,
      avgOrderValue,
      pendingCount,
      successCount: deliveredCount,
      salesByMonth: monthly,
      salesByState: salesByState.map(s => ({ label: String(s._id || 'Unknown').trim(), total: s.total })),
      ordersByStatus,
      topProducts
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/* ================== COUPONS ================== */
export async function getCoupons(req, res) {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, coupons });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error fetching coupons' });
  }
}

export async function createCoupon(req, res) {
  try {
    const { code, discountType, discountValue, minOrderValue = 0 } = req.body || {};

    if (!code || !discountType || !Number(discountValue)) {
      return res.status(400).json({ success: false, error: 'Code, type and value are required' });
    }

    if (discountType === 'percentage' && Number(discountValue) > 100) {
      return res.status(400).json({ success: false, error: 'Percentage discount cannot exceed 100%' });
    }

    const coupon = await Coupon.create({
      code: String(code).trim().toUpperCase(),
      discountType,
      discountValue: Number(discountValue),
      minOrderValue: Number(minOrderValue) || 0
    });

    res.json({ success: true, coupon });
  } catch (err) {
    const duplicate = String(err.message || err).includes('E11000');
    res.status(duplicate ? 409 : 400).json({
      success: false,
      error: duplicate ? 'Coupon code already exists' : err.message
    });
  }
}

export async function deleteCoupon(req, res) {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, error: 'Coupon not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Delete failed' });
  }
}

/* ================== BUNDLE RULES ================== */
export async function getBundleRules(req, res) {
  try {
    const rules = await BundleRule.find().sort({ sizeMl: 1, setQty: 1 }).lean();
    res.json({ success: true, rules });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error fetching bundle rules' });
  }
}

export async function upsertBundleRule(req, res) {
  try {
    const {
      sizeMl,
      setQty,
      label = '',
      discountType = 'none',
      discountValue = 0,
      freeGiftEnabled = false,
      freeGiftName = '',
      freeGiftSize = '',
      freeGiftProductId = '',
      freeGiftType = '',
      freeGiftImage = '',
      minCartValue = 0,
      isActive = true
    } = req.body || {};

    const numericSize = Number(sizeMl);
    const numericQty = Number(setQty);

    if (![8, 20].includes(numericSize) || ![2, 4, 6].includes(numericQty)) {
      return res.status(400).json({ success: false, error: 'Invalid bundle size or quantity' });
    }

    if (numericSize === 8 && ![4, 6].includes(numericQty)) {
      return res.status(400).json({ success: false, error: '8 ml bundles support set of 4 or 6' });
    }

    if (numericSize === 20 && ![2, 4].includes(numericQty)) {
      return res.status(400).json({ success: false, error: '20 ml bundles support set of 2 or 4' });
    }

    if (discountType === 'percentage' && Number(discountValue) > 100) {
      return res.status(400).json({ success: false, error: 'Percentage discount cannot exceed 100%' });
    }

    const rule = await BundleRule.findOneAndUpdate(
      { sizeMl: numericSize, setQty: numericQty },
      {
        sizeMl: numericSize,
        setQty: numericQty,
        label: label || `${numericQty} x ${numericSize} ml Custom Set`,
        discountType,
        discountValue: Number(discountValue) || 0,
        freeGiftEnabled: Boolean(freeGiftEnabled),
        freeGiftName,
        freeGiftSize,
        freeGiftProductId,
        freeGiftType,
        freeGiftImage,
        minCartValue: Number(minCartValue) || 0,
        isActive: Boolean(isActive)
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, rule });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message || 'Could not save bundle rule' });
  }
}

export async function deleteBundleRule(req, res) {
  try {
    const rule = await BundleRule.findByIdAndDelete(req.params.id);
    if (!rule) return res.status(404).json({ success: false, error: 'Bundle rule not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Delete failed' });
  }
}



/* ================== USERS ================== */
export async function getUsers(req, res) {
  try {
    const q = (req.query.q || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const skip = (page - 1) * limit;

    const filter = q
      ? {
          $or: [
            { email: { $regex: q, $options: 'i' } },
            { name: { $regex: q, $options: 'i' } },
            { phone: { $regex: q, $options: 'i' } }
          ]
        }
      : {};

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('name email phone address isVerified createdAt')
      .lean();

    res.json({ success: true, users, total, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error fetching users' });
  }
}



/* ================== UPDATE ORDER STATUS ================== */
export async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: 'Status required' });
    }

    const order = await Order.findOneAndUpdate(
      {
        $or: [
          { _id: mongoose.Types.ObjectId.isValid(id) ? id : null },
          { orderId: id }
        ]
      },
      { status },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    res.json({ success: true, order });
  } catch (err) {
    console.error('updateOrderStatus error', err);
    res.status(500).json({ success: false, error: 'Update failed' });
  }
}

/* ================== CANCEL ORDER ================== */
export async function cancelOrder(req, res) {
  try {
    const { id } = req.params;

    const order = await Order.findOneAndUpdate(
      {
        $or: [
          { _id: mongoose.Types.ObjectId.isValid(id) ? id : null },
          { orderId: id }
        ]
      },
      { status: 'Cancelled' },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    res.json({ success: true, order });
  } catch (err) {
    console.error('cancelOrder error', err);
    res.status(500).json({ success: false, error: 'Cancel failed' });
  }
}

/* ================== DELETE ORDER ================== */
export async function deleteOrder(req, res) {
  try {
    const { id } = req.params;

    const order = await Order.findOneAndDelete({
      $or: [
        { _id: mongoose.Types.ObjectId.isValid(id) ? id : null },
        { orderId: id }
      ]
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('deleteOrder error', err);
    res.status(500).json({ success: false, error: 'Delete failed' });
  }
}
