import Order from '../models/Order.js';

export async function generateOrderId() {
  const year = new Date().getFullYear();

  const lastOrder = await Order
    .findOne({ orderId: { $regex: `^EE${year}` } })
    .sort({ createdAt: -1 });

  let next = 1;

  if (lastOrder?.orderId) {
    const lastNum = parseInt(lastOrder.orderId.slice(-4));
    if (!isNaN(lastNum)) next = lastNum + 1;
  }

  return `EE${year}${String(next).padStart(4, '0')}`;
}
