
//controllers/wishlistController.js
import Wishlist from "../models/Wishlist.js";
import User from "../models/User.js";

/* =========================
   GET WISHLIST
========================= */
export const getWishlist = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const items = await Wishlist.find({ user: userId }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      wishlist: items
    });
  } catch (err) {
    console.error("getWishlist error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
};

/* =========================
   ADD TO WISHLIST
========================= */
export const addToWishlist = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { productId, name, image, price } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    if (!productId) {
      return res.status(400).json({ success: false, error: "productId required" });
    }

    // 🔁 prevent duplicates
    const exists = await Wishlist.findOne({
      user: userId,
      productId: String(productId)
    });

    if (exists) {
      return res.json({
        success: true,
        message: "Already in wishlist"
      });
    }

    const item = await Wishlist.create({
      user: userId,
      productId: String(productId),
      name,
      image,
      price
    });

    return res.json({
      success: true,
      message: "Added to wishlist",
      item
    });
  } catch (err) {
    console.error("addToWishlist error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
};

/* =========================
   REMOVE FROM WISHLIST
========================= */
export const removeFromWishlist = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { productId } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    if (!productId) {
      return res.status(400).json({ success: false, error: "productId required" });
    }

    await Wishlist.findOneAndDelete({
      user: userId,
      productId: String(productId)
    });

    return res.json({
      success: true,
      message: "Removed from wishlist"
    });
  } catch (err) {
    console.error("removeFromWishlist error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
};
