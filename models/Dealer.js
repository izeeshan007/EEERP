const mongoose = require("mongoose");

const DealerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  companyName: { type: String, default: "", trim: true },
  phone: { type: String, default: "", trim: true },
  email: { type: String, default: "", trim: true, lowercase: true },
  address: { type: String, default: "", trim: true },
  notes: { type: String, default: "", trim: true },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true });

DealerSchema.index({ name: 1, companyName: 1 }, { unique: true });

module.exports = mongoose.model("Dealer", DealerSchema);
