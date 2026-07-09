import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

export function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Missing token' });
    }

    const token = auth.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);

    if (payload?.isAdmin !== true) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

export default requireAdmin;
