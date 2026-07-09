import Razorpay from 'razorpay';
import crypto from 'crypto';
import Order from '../models/Order.js';
import { generateOrderId } from '../utils/orderIdGenerator.js';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// 🟢 CREATE ORDER (RAZORPAY)
export async function createRazorpayOrder(req, res) {
  try {
    const { cart, subtotal, discount, total, customer } = req.body;

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
      total,
      paymentMethod: 'Razorpay',
      status: 'PENDING_PAYMENT'
    });

    const rzpOrder = await razorpay.orders.create({
      amount: Math.round(total * 100),
      currency: 'INR',
      receipt: orderId
    });

    order.razorpay_order_id = rzpOrder.id;
    await order.save();

    res.json({
      success: true,
      keyId: process.env.RAZORPAY_KEY_ID,
      razorpayOrderId: rzpOrder.id,
      amount: rzpOrder.amount,
      orderId: order.orderId,   // customer order id
      dbId: order._id           // mongodb id
    });

  } catch (err) {
    console.error('create-razorpay-order error:', err);
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
}

// 🟢 VERIFY PAYMENT
export async function verifyRazorpay(req, res) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const order = await Order.findOne({ razorpay_order_id });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      order.status = 'PAYMENT_FAILED';
      await order.save();
      return res.status(400).json({ error: 'Invalid signature' });
    }

    order.status = 'PAID';
    order.razorpay_payment_id = razorpay_payment_id;
    order.razorpay_signature = razorpay_signature;
    await order.save();

    res.json({ success: true, orderId: order.orderId });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed' });
  }
}

// 🟢 USER ORDERS
export async function getMyOrders(req, res) {
  const email = req.user.email;
  const orders = await Order.find({ buyerEmail: email }).sort({ createdAt: -1 });
  res.json({ success: true, orders });
}

// 🟢 CANCEL ORDER
export async function cancelOrder(req, res) {
  const order = await Order.findById(req.params.id);

  if (!order) return res.json({ success: false, error: 'Order not found' });

  if (['SHIPPED', 'DELIVERED'].includes(order.status)) {
    return res.json({ success: false, error: 'Order already shipped' });
  }

  order.status = 'CANCELLED';
  await order.save();

  res.json({ success: true });
}


export async function retryRazorpayPayment(req, res) {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (order.status === 'PAID') {
      return res.json({ success: false, error: 'Order already paid' });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const rzpOrder = await razorpay.orders.create({
      amount: Math.round(order.total * 100),
      currency: 'INR',
      receipt: order.orderId
    });

    order.razorpay_order_id = rzpOrder.id;
    order.status = 'PENDING_PAYMENT';
    await order.save();

    return res.json({
      success: true,
      razorpayOrderId: rzpOrder.id,
      amount: rzpOrder.amount,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order._id
    });

  } catch (err) {
    console.error('retry payment error:', err);
    res.status(500).json({ success: false, error: 'Retry failed' });
  }
}
