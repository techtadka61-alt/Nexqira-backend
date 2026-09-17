// backend/src/models/Visitor.js
const mongoose = require('mongoose');

const visitorSchema = new mongoose.Schema(
  {
    // One document per public IP. Legacy anonymous records do not have this field.
    ip: { type: String, index: true, sparse: true },
    visitorHash: {
      type: String,
      required: true,
      index: true
    },
    // Day bucket in YYYY-MM-DD (UTC) form, used for daily-unique enforcement.
    day: {
      type: String,
      required: true,
      index: true
    },
    firstSeenAt: {
      type: Date,
      default: Date.now
    },
    lastSeenAt: {
      type: Date,
      default: Date.now
    },
    visitCount: {
      type: Number,
      default: 1
    },
    path: {
      type: String,
      default: '',
      maxlength: 300
    },
    userAgent: { type: String, default: '', maxlength: 1000 },
    device: {
      type: { type: String, default: 'Unknown' },
      os: { type: String, default: 'Unknown' },
      browser: { type: String, default: 'Unknown' }
    },
    // Filled from hosting/CDN geo headers when they are available. No IP is sent to a third party.
    location: {
      country: { type: String, default: '' },
      region: { type: String, default: '' },
      city: { type: String, default: '' },
      postal: { type: String, default: '' },
      latitude: Number,
      longitude: Number,
      timezone: { type: String, default: '' }
    }
  },
  {
    timestamps: true
  }
);

visitorSchema.index({ visitorHash: 1, day: 1 }, { unique: true });
visitorSchema.index({ day: 1 });
visitorSchema.index({ ip: 1 }, { unique: true, sparse: true });
visitorSchema.index({ lastSeenAt: -1 });

module.exports = mongoose.model('Visitor', visitorSchema);
