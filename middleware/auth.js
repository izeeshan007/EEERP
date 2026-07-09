import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export default async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.replace('Bearer ', '').trim();

    if (!token) {
      return res.status(401).json({ success: false, error: 'No token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
}
