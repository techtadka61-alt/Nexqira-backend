// backend/src/models/VisitorSession.js
const mongoose = require('mongoose');

const visitorSessionSchema = new mongoose.Schema(
  {
    // = clientId generated client-side (localStorage nq_visitor_id), one doc per browser tab-session.
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    visitorHash: { type: String, index: true },
    ip: { type: String, index: true, sparse: true },
    userAgent: { type: String, default: '', maxlength: 1000 },
    device: {
      type: { type: String, default: 'Unknown' },
      os: { type: String, default: 'Unknown' },
      browser: { type: String, default: 'Unknown' }
    },
    location: {
      country: { type: String, default: '' },
      region: { type: String, default: '' },
      city: { type: String, default: '' },
      postal: { type: String, default: '' },
      latitude: Number,
      longitude: Number,
      timezone: { type: String, default: '' },
      // Which resolver produced this location: 'header' | 'ipinfo' | 'geoip-lite'.
      source: { type: String, default: '' }
    },
    // First-touch attribution, set once on insert and never overwritten.
    referrer: { type: String, default: '', maxlength: 500 },
    utm: {
      source: { type: String, default: '', maxlength: 200 },
      medium: { type: String, default: '', maxlength: 200 },
      campaign: { type: String, default: '', maxlength: 200 },
      term: { type: String, default: '', maxlength: 200 },
      content: { type: String, default: '', maxlength: 200 }
    },
    landingPage: { type: String, default: '', maxlength: 300 },
    firstActivityAt: { type: Date, default: Date.now },
    lastActivityAt: { type: Date, default: Date.now },
    pageViewCount: { type: Number, default: 0 },
    isReturning: { type: Boolean, default: false },
    convertedLead: {
      leadType: { type: String, enum: ['contact', 'chat', null], default: null },
      leadId: { type: mongoose.Schema.Types.ObjectId, default: null },
      convertedAt: { type: Date, default: null }
    }
  },
  {
    timestamps: true
  }
);

visitorSessionSchema.index({ visitorHash: 1, firstActivityAt: 1 });
visitorSessionSchema.index({ lastActivityAt: -1 });
visitorSessionSchema.index({ 'utm.source': 1 });
visitorSessionSchema.index({ 'convertedLead.leadId': 1 }, { sparse: true });

module.exports = mongoose.model('VisitorSession', visitorSessionSchema);
