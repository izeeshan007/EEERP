const mongoose = require("mongoose");

const SaleSchema = new mongoose.Schema({
  externalReference: { type: String, unique: true, sparse: true, index: true },
  externalOrderId: { type: String, default: null, index: true },
  externalSource: { type: String, default: null },
  externalStatus: { type: String, default: null },
  paymentStatus: { type: String, enum: ["UNPAID", "PARTIAL", "PAID", "NOT_APPLICABLE", null], default: null },
  amountReceived: { type: Number, default: 0, min: 0 },
  paymentUpdatedAt: { type: Date, default: null },
  category: String,
  productName: String,
  designerName: String,
  // Legacy field retained for compatibility; Bakhoor sizes are grams.
  size_ml: Number,
  quantityUnit: { type: String, enum: ['g', 'ml'] },
  units: Number,
  customerName: String,
  counterpartyType: { type: String, enum: ["customer", "dealer"], default: "customer", index: true },
  counterpartyKey: { type: String, default: "", index: true },
  dealerId: { type: mongoose.Schema.Types.ObjectId, ref: "Dealer", default: null, index: true },
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

  // Samples/trials are acquisition expenses, not zero-value revenue sales.
  isAcquisitionCost: { type: Boolean, default: false, index: true },
  acquisitionType: { type: String, enum: ["sample", "trial", null], default: null },
  acquisitionNotes: { type: String, default: "" },

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
  customerEmail: { type: String, default: "" },
  variantLabel: { type: String, default: "" },
  couponCode: { type: String, default: "" },
  shippingCharge: { type: Number, default: 0 },
  orderSubtotal: { type: Number, default: 0 },
  orderTotal: { type: Number, default: 0 },
  sourcePayload: { type: mongoose.Schema.Types.Mixed, default: null },
  
  isDelivered: { type: Boolean, default: false },
  isPaid: { type: Boolean, default: false },
  saleDate: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model("Sale", SaleSchema);
