require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');

function getMongoUri() {
  const raw = (
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    process.env.DATABASE_URL ||
    process.env.MONGODB_URL ||
    ''
  ).trim();

  if (!raw) return '';

  // If the URI doesn't specify a db name (pathname is '/'), default it.
  // This avoids accidentally connecting to the 'test' database.
  const defaultDb = (process.env.MONGODB_DBNAME || process.env.DB_NAME || 'test').trim();
  try {
    const u = new URL(raw);
    if ((u.pathname === '/' || !u.pathname) && defaultDb) {
      u.pathname = `/${defaultDb}`;
      return u.toString();
    }
  } catch {
    // ignore URL parsing errors and return raw
  }

  return raw;
}

const connectDB = async () => {
  try {
    const uri = getMongoUri();
    if (!uri) {
      throw new Error('Missing MongoDB connection string. Set MONGODB_URI (or MONGO_URI / DATABASE_URL).');
    }

    // If already connected in this process, reuse.
    if (mongoose.connection.readyState === 1) return mongoose.connection;

    // Cache across hot reloads / serverless invocations (best effort).
    const cacheKey = '__mongooseTechNews';
    const cached = globalThis[cacheKey] || (globalThis[cacheKey] = { conn: null, promise: null });
    if (cached.conn) return cached.conn;

    if (!cached.promise) {
      cached.promise = mongoose
        .connect(uri, {
          maxPoolSize: 10,
          serverSelectionTimeoutMS: 10000
        })
        .then((m) => m.connection);
    }

    cached.conn = await cached.promise;
    console.log(`MongoDB Connected: ${cached.conn.host}`);
    return cached.conn;
  } catch (error) {
    console.error('MongoDB connect error:', error?.name, error?.message);
    throw error;
  }
};

module.exports = connectDB;