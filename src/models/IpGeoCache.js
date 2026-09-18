// backend/src/models/IpGeoCache.js
const mongoose = require('mongoose');

// Shared cache so Visitor and VisitorSession tracking never call ipinfo.io twice
// for the same IP. Re-fetched after expiry in case the IP was reassigned.
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

const ipGeoCacheSchema = new mongoose.Schema({
  ip: { type: String, required: true, unique: true, index: true },
  location: {
    country: { type: String, default: '' },
    region: { type: String, default: '' },
    city: { type: String, default: '' },
    postal: { type: String, default: '' },
    latitude: Number,
    longitude: Number,
    timezone: { type: String, default: '' }
  },
  source: { type: String, enum: ['ipinfo', 'geoip-lite'], required: true },
  fetchedAt: { type: Date, default: Date.now, expires: CACHE_TTL_SECONDS }
});

module.exports = mongoose.model('IpGeoCache', ipGeoCacheSchema);
