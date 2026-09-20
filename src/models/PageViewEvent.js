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
  },
  // Filled in later: either when the next page view arrives in the same session
  // (duration = next.timestamp - this.timestamp), or via the exit beacon when the
  // visitor leaves the site from this page.
  durationMs: { type: Number, default: null },
  // True once we know this was the last page viewed in the session (exit beacon fired,
  // or the session ended without a subsequent page view before the tab closed).
  isExit: { type: Boolean, default: false },
  exitAt: { type: Date, default: null }
});

pageViewEventSchema.index({ sessionId: 1, timestamp: -1 });
pageViewEventSchema.index({ path: 1, timestamp: -1 });

module.exports = mongoose.model('PageViewEvent', pageViewEventSchema);
