// models/User.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  email: { type: String, unique: true, required: true, lowercase: true, trim: true },
  phone: { type: String, default: '' },
  passwordHash: { type: String, default: '', select: true }, // keep accessible when explicitly requested
  isVerified: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false }, // allow marking DB users as admin
  wishlist: [{ type: Number }], // store product ids
  address: {
    name: String,
    phone: String,
    addressLine: String,
    city: String,
    pincode: String,
    state: String
  },
  createdAt: { type: Date, default: Date.now }
});

// avoid duplicate model compile errors in dev hot-reload
export default mongoose.models.User || mongoose.model('User', userSchema);
