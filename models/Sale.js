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
  
  // --- Margin & Deep Entry Tracking ---
  distributorMargin: { type: Number, default: 0 },
  saleCat: String,
  bottleCat: String,
  bottlePrice: Number,
  boxName: String,
  pouchName: String,
  oilPercent: Number,
  otherCost: Number,

  // --- NEW: Batch & Pre-mix logic ---
  isFromBatch: { type: Boolean, default: false },
  sourceBatchId: { type: String, default: null },
  
  // --- Item Level vs Invoice Level ---
  discount: { type: Number, default: 0 }, 
  invoiceNumber: { type: String, default: null },
  invoiceDiscount: { type: Number, default: 0 },
  revisionCount: { type: Number, default: 0 }, 
  
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