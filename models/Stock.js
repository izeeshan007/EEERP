const mongoose = require("mongoose");

const StockSchema = new mongoose.Schema({
  category: String,
  subCategory: String,
  type: String,

  name: String,
  designerName: String,
  supplier: String,

  // Legacy shared quantity field: grams for Bakhoor/Aroma Chemical, ml for liquids.
  size_ml: Number,
  quantityUnit: { type: String, enum: ['g', 'ml'] },
  units: Number,

  cost: Number,
  pricePerUnit: Number,

  // --- NEW: Log concentration if it's a finished batch ---
  oilPercent: { type: Number, default: 0 },
  
  status: { type: String, default: "Active" }, // "Active", "Dead Stock", "Loss"

  purchaseDate: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Stock", StockSchema);
