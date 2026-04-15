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
  
  // --- Item Level vs Invoice Level ---
  discount: { type: Number, default: 0 }, 
  invoiceNumber: { type: String, default: null },
  invoiceDiscount: { type: Number, default: 0 },
  revisionCount: { type: Number, default: 0 }, // NEW: Tracks how many times an invoice was modified
  
  // --- Tax & Customer Info ---
  cgstPercent: { type: Number, default: 0 },
  sgstPercent: { type: Number, default: 0 },
  igstPercent: { type: Number, default: 0 },
  customerAddress: { type: String, default: "" },
  customerPhone: { type: String, default: "" },
  
  isDelivered: { type: Boolean, default: false },
  isPaid: { type: Boolean, default: false },
  saleDate: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Sale", SaleSchema);