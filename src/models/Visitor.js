// backend/src/models/Visitor.js
const mongoose = require('mongoose');

// Privacy-conscious visitor tracking: stores a hashed anonymous visitor id
// (never a raw IP) plus a day bucket so a single visitor counts once per day.
const visitorSchema = new mongoose.Schema(
  {
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
    }
  },
  {
    timestamps: true
  }
);

visitorSchema.index({ visitorHash: 1, day: 1 }, { unique: true });
visitorSchema.index({ day: 1 });

module.exports = mongoose.model('Visitor', visitorSchema);
