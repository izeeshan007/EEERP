const DAY = 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'eeerp.sid';

function sessionPolicy(env = process.env) {
 const boundedDays = (value, fallback, max) => Number.isFinite(Number(value)) && Number(value) >= 1 ? Math.min(max, Number(value)) : fallback;
 const absoluteMs = boundedDays(env.SESSION_MAX_DAYS, 30, 90) * DAY;
 return { idleMs: Math.min(absoluteMs, boundedDays(env.SESSION_IDLE_DAYS, 7, 30) * DAY), absoluteMs };
}

function sessionOptions({ secret, store, production, policy }) {
 return {
  name: COOKIE_NAME, secret, store, resave: false, saveUninitialized: false, rolling: true,
  cookie: { secure: production, sameSite: 'lax', httpOnly: true, path: '/', maxAge: policy.idleMs }
 };
}

function enforceSessionLifetime(policy, now = Date.now) {
 return (req, res, next) => {
  if (!req.session?.authenticated) return next();
  const createdAt = Number(req.session.authenticatedAt || now());
  req.session.authenticatedAt = createdAt;
  const remaining = createdAt + policy.absoluteMs - now();
  if (remaining <= 0) {
   return req.session.destroy(error => {
    if (error) return res.status(503).json({ success: false, code: 'SESSION_UNAVAILABLE', message: 'Session service is temporarily unavailable. Please retry.' });
    res.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'lax', secure: req.secure });
    return res.status(401).json({ success: false, code: 'SESSION_EXPIRED', message: 'Please sign in again.' });
   });
  }
  req.session.cookie.maxAge = Math.min(policy.idleMs, remaining);
  next();
 };
}

function createLoginHandler(env = process.env) {
 return async (req, res, next) => {
  const { username, password } = req.body || {};
  if (!env.ADMIN_USER || !env.ADMIN_PASS) return res.status(503).json({ success: false, code: 'ADMIN_CONFIGURATION', message: 'ERP admin credentials are not configured.' });
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) return res.status(400).json({ success: false, message: 'Username and password are required.' });
  if (username !== env.ADMIN_USER || password !== env.ADMIN_PASS) return res.status(401).json({ success: false, message: 'Invalid credentials' });
  let stage = 'SESSION_CREATE_FAILED';
  try {
   if (!req.session || typeof req.session.regenerate !== 'function') throw new Error('Session middleware did not provide a session.');
   await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
   stage = 'SESSION_SAVE_FAILED';
   req.session.authenticated = true;
   req.session.authenticatedAt = Date.now();
   await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
   return res.json({ success: true });
  } catch (cause) {
   // Do not let express-session automatically retry saving authenticated data
   // after a failed explicit save, or issue a successful-login cookie.
   req.session = null;
   const error = new Error('Admin login session operation failed.', { cause });
   error.status = 503;
   error.apiCode = stage;
   error.publicMessage = stage === 'SESSION_CREATE_FAILED'
    ? 'Could not create your login session. Check the ERP server logs for the reference below.'
    : 'Could not save your login session in MongoDB. Check the ERP server logs for the reference below.';
   return next(error);
  }
 };
}

function apiErrorHandler(error, req, res, next) {
 if (!req.path.startsWith('/api/')) return next(error);
 const reference = require('node:crypto').randomUUID();
 const status = error.type === 'entity.parse.failed' ? 400 : error.status === 413 ? 413 : error.status === 503 ? 503 : 500;
 const code = error.apiCode || (status === 400 ? 'INVALID_JSON' : status === 413 ? 'REQUEST_TOO_LARGE' : 'ERP_API_ERROR');
 // Never log passwords, request bodies, cookies or connection-string credentials.
 const diagnostic = String(error.cause?.stack || error.stack || error)
  .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[REDACTED_MONGODB_URI]');
 console.error(`[EEERP ${reference}] ${req.method} ${req.path} ${code}\n${diagnostic}`);
 if (res.headersSent) return next(error);
 const message = error.publicMessage || (status === 400 ? 'The request contains invalid JSON.' : status === 413 ? 'The request is too large.' : 'ERP could not complete this request. Check the server logs using this reference.');
 return res.status(status).set('Cache-Control', 'no-store').json({ success: false, code, message, reference });
}

module.exports = { COOKIE_NAME, sessionPolicy, sessionOptions, enforceSessionLifetime, createLoginHandler, apiErrorHandler };
