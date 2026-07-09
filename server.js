// server.js
import './config/env.js'; // load dotenv + env normalization first

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

import { ENV, isSmtpConfigured, isJwtConfigured } from './config/env.js';
import { connectDB } from './config/db.js';

import authRoutes from './routes/authRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import productRoutes from './routes/productRoutes.js';
import adminRoutes from './routes/admin.js';
import reviewRoutes from './routes/reviewRoutes.js';
import wishlistRoutes from "./routes/wishlist.js";

const require = createRequire(import.meta.url);
const app = express();
const PORT = ENV.PORT || 5000;

/* ================== PATH HELPERS ================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ================== STARTUP DIAGNOSTICS ================== */
console.log('--- ADMIN ENV ---');
console.log('FRONTEND_URL:', ENV.FRONTEND_URL || '(not set)');
console.log('SMTP configured (env):', isSmtpConfigured());
console.log('JWT configured:', isJwtConfigured());
console.log('PORT:', PORT);
console.log('--------------------------------');

/* ================== CORS ================== */
const allowedOrigins = [];
if (ENV.FRONTEND_URL) allowedOrigins.push(ENV.FRONTEND_URL);
if (ENV.FRONTEND_URL?.includes('netlify.app')) allowedOrigins.push(ENV.FRONTEND_URL);

allowedOrigins.push(
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
);

/* ================== CORS ================== */
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    const allowed = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      ENV.FRONTEND_URL
    ].filter(Boolean);

    if (allowed.includes(origin) || origin.includes('netlify.app')) {
      return callback(null, true);
    }

    return callback(new Error('CORS blocked: ' + origin));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// 🔥 REQUIRED for DELETE / PUT / Authorization
app.options('*', cors());


/* ================== BODY PARSERS ================== */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ================== ✅ STATIC IMAGES (IMPORTANT FIX) ================== */
/**
 * Images stored in:
 * /public/products/Blue_OUD.png
 *
 * Public URL:
 * http://localhost:5000/products/Blue_OUD.png
 */
app.use(
  '/products',
  express.static(path.join(__dirname, 'public/products'))
);

/* ================== ROUTES ================== */
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/products', productRoutes);
app.use('/api/reviews', reviewRoutes);
app.use("/api/wishlist", wishlistRoutes);

/* ================== HEALTH CHECK ================== */
app.get('/', (req, res) => {
  res.json({ success: true, message: 'Eternal Essence backend running.' });
});

/* ================== ADMIN ROUTES (ESM + CJS SAFE) ================== */
app.use('/api/admin', adminRoutes);


/* ================== START SERVER ================== */
(async () => {
  try {
    if (!ENV.MONGODB_URI) {
      throw new Error('MONGODB_URI not set');
    }
    await connectDB(ENV.MONGODB_URI);
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🖼 Images served at /products/*`);
    });
  } catch (err) {
    console.error('Startup failed:', err.message || err);
    process.exit(1);
  }
})();
