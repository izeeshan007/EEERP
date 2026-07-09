import mongoose from "mongoose";

const wishlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    productId: {
      type: String,
      required: true
    },
    name: String,
    image: String,
    price: Number
  },
  { timestamps: true }
);

export default mongoose.models.Wishlist ||
  mongoose.model("Wishlist", wishlistSchema);
