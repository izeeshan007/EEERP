// routes/authRoutes.js
import express from "express";
import {
  registerHandler,
  sendOtpHandler,
  verifyOtpHandler,
  loginHandler,
  forgotPasswordHandler,
  verifyResetOtpHandler,
  resetPasswordHandler,
  getProfileHandler,
  updateProfileHandler,
  addToWishlistHandler,
  removeFromWishlistHandler,
  getWishlistHandler  
} from "../controllers/authController.js";


const router = express.Router();

/* ============ AUTH / OTP ============ */

router.post("/register", registerHandler);
router.post("/send-otp", sendOtpHandler);
router.post("/verify-otp", verifyOtpHandler);
router.post("/login", loginHandler);

/* ============ FORGOT PASSWORD ============ */

router.post("/forgot-password", forgotPasswordHandler);
router.post("/verify-reset-otp", verifyResetOtpHandler);
router.post("/reset-password", resetPasswordHandler);

/* ============ PROFILE ============ */

router.get("/me", getProfileHandler);
router.put("/me", updateProfileHandler);

/* ============ WISHLIST ============ */
router.post("/wishlist/add", addToWishlistHandler);
router.post("/wishlist/remove", removeFromWishlistHandler);
router.get("/wishlist", getWishlistHandler);


export default router;
