// models/Otp.js
import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, index: true },
  code: { type: String, required: true },
  purpose: { type: String, default: 'signup' }, // signup | guest | reset
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, required: true } // remove index:true here to avoid duplication
});

// ttl index — remove duplicates elsewhere if present
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.Otp || mongoose.model('Otp', otpSchema);
