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
  isDelivered: { type: Boolean, default: false },
  isPaid: { type: Boolean, default: false },
  // ------------------
  saleDate: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Sale", SaleSchema);