import express from "express";
import {
  addToWishlist,
  removeFromWishlist,
  getWishlist
} from "../controllers/wishlistController.js";

// ✅ alias existing middleware instead of changing backend
import { authMiddleware as protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", protect, getWishlist);
router.post("/add", protect, addToWishlist);
router.post("/remove", protect, removeFromWishlist);

export default router;
