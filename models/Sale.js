const mongoose = require("mongoose");

const SaleSchema = new mongoose.Schema({
  category: String,
  productName: String,
  designerName: String,
  size_ml: Number,
  units: Number,
  customerName: String,
  referenceSource: String,
  manufacturingCost: Number,
  soldPrice: Number,
  profit: Number,
  profitPercent: Number,
  // --- New Fields ---
  discount: { type: Number, default: 0 },
  invoiceNumber: { type: String, default: null }, // Used to merge multiple items into one invoice
  isDelivered: { type: Boolean, default: false },
  isPaid: { type: Boolean, default: false },
  // ------------------
  saleDate: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Sale", SaleSchema);