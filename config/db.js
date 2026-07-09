// config/db.js
import mongoose from 'mongoose';

/**
 * connectDB(rawUri, maxRetries=5, retryDelayMs=2000)
 * - Strips accidental "KEY=" prefix, fixes common "mongodb+srv//" typo,
 * - Validates scheme, masks sensitive parts in logs, retries connection.
 */
export async function connectDB(rawUri, maxRetries = 5, retryDelayMs = 2000) {
  if (!rawUri) {
    throw new Error('MONGODB_URI not set (empty). Please set MONGODB_URI in your .env file.');
  }

  // If someone accidentally passed "MONGODB_URI=..." keep only after '='
  let uri = rawUri.includes('=') && !rawUri.startsWith('mongodb')
    ? rawUri.split('=').slice(1).join('=').trim()
    : rawUri.trim();

  // Fix common typo: ensure "mongodb+srv://" (not "mongodb+srv//")
  uri = uri.replace(/^mongodb\+srv:\/\//i, 'mongodb+srv://') // no-op if correct
           .replace(/^mongodb\+srv:\/{1}([^/])/, 'mongodb+srv://$1')
           .replace(/^mongodb:\/{1}([^/])/, 'mongodb://$1');

  // Validate scheme
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    const preview = uri.length > 80 ? uri.slice(0, 80) + '...' : uri;
    throw new Error(`Invalid scheme in MONGODB_URI. Expected "mongodb://" or "mongodb+srv://". Received: "${preview}"`);
  }

  // Mask password for logging
  let safePreview = uri;
  try {
    const atIdx = uri.lastIndexOf('@');
    if (atIdx > -1) {
      const beforeAt = uri.slice(0, atIdx); // e.g. mongodb+srv://user:pass
      const afterAt = uri.slice(atIdx + 1);
      const slashIdx = beforeAt.indexOf('//');
      const creds = slashIdx > -1 ? beforeAt.slice(slashIdx + 2) : beforeAt;
      if (creds.includes(':')) {
        const user = creds.split(':')[0];
        safePreview = `${beforeAt.slice(0, slashIdx + 2)}${user}:[REDACTED]@${afterAt}`;
      }
    }
  } catch (e) {
    safePreview = uri.slice(0, 60) + (uri.length > 60 ? '...' : '');
  }

  console.log('Attempting MongoDB connect ->', safePreview);

  // Modern connection options for mongoose (no keepAlive)
  const connectOptions = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    // socketTimeoutMS, serverSelectionTimeoutMS etc can be set if needed
    // socketTimeoutMS: 45000,
    // serverSelectionTimeoutMS: 30000,
  };

  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      await mongoose.connect(uri, connectOptions);
      console.log('✅ MongoDB connected — db:', mongoose.connection.name || '(unknown)');
      return mongoose.connection;
    } catch (err) {
      attempt++;
      console.warn(`MongoDB connection attempt ${attempt} failed:`, err.message || err);
      if (attempt >= maxRetries) {
        throw err;
      }
      console.log(`Retrying in ${retryDelayMs}ms...`);
      await new Promise(r => setTimeout(r, retryDelayMs));
    }
  }
}
