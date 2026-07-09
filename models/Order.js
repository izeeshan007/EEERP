import mongoose from 'mongoose';

const ItemSchema = new mongoose.Schema(
  {
    productId: String,
    name: String,
    size: String,
    price: Number,
    image: String,
    itemType: String,
    bundleMeta: mongoose.Schema.Types.Mixed
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema({
  // MongoDB _id already exists automatically

  orderId: {
    type: String,
    unique: true,
    sparse: true // ✅ VERY IMPORTANT (prevents null duplicate error)
  },

  buyerEmail: String,
  name: String,
  phone: String,
  shippingAddress: String,

  items: [ItemSchema],

  subtotal: Number,
  discount: Number,
  couponCode: String,
  freeGift: mongoose.Schema.Types.Mixed,
  shipping: Number,
  total: Number,

  paymentMethod: String,
  status: {
    type: String,
    default: 'PENDING_PAYMENT'
  },

  razorpay_order_id: String,
  razorpay_payment_id: String,
  razorpay_signature: String,

  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('Order', OrderSchema);
