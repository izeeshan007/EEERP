import mongoose from 'mongoose';

const bundleRuleSchema = new mongoose.Schema(
  {
    sizeMl: {
      type: Number,
      enum: [8, 20],
      required: true
    },
    setQty: {
      type: Number,
      enum: [2, 4, 6],
      required: true
    },
    label: {
      type: String,
      trim: true,
      default: ''
    },
    discountType: {
      type: String,
      enum: ['none', 'percentage', 'fixed'],
      default: 'none'
    },
    discountValue: {
      type: Number,
      default: 0,
      min: 0
    },
    freeGiftEnabled: {
      type: Boolean,
      default: false
    },
    freeGiftName: {
      type: String,
      trim: true,
      default: ''
    },
    freeGiftSize: {
      type: String,
      trim: true,
      default: ''
    },
    freeGiftProductId: {
      type: String,
      trim: true,
      default: ''
    },
    freeGiftType: {
      type: String,
      trim: true,
      default: ''
    },
    freeGiftImage: {
      type: String,
      trim: true,
      default: ''
    },
    minCartValue: {
      type: Number,
      default: 0,
      min: 0
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

bundleRuleSchema.index({ sizeMl: 1, setQty: 1 }, { unique: true });

export default mongoose.model('BundleRule', bundleRuleSchema);
