// backend/src/models/PageViewEvent.js
const mongoose = require('mongoose');

const RETENTION_SECONDS = (Number(process.env.ANALYTICS_RETENTION_DAYS) || 90) * 24 * 60 * 60;

const pageViewEventSchema = new mongoose.Schema({
  // References VisitorSession.sessionId (string, not ObjectId - avoids a lookup on write).
  sessionId: { type: String, required: true, index: true },
  path: { type: String, default: '', maxlength: 300 },
  referrer: { type: String, default: '', maxlength: 500 },
  timestamp: {
    type: Date,
    default: Date.now,
    // TTL index. Mongo fixes expireAfterSeconds at index creation time; changing
    // ANALYTICS_RETENTION_DAYS later requires a manual collMod on the deployed
    // collection, not just a redeploy - the index does not "hot reload".
    expires: RETENTION_SECONDS
  }
});

pageViewEventSchema.index({ sessionId: 1, timestamp: -1 });
pageViewEventSchema.index({ path: 1, timestamp: -1 });

module.exports = mongoose.model('PageViewEvent', pageViewEventSchema);
