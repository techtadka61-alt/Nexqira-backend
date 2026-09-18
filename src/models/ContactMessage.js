const mongoose = require('mongoose');

const contactMessageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 120
    },
    phone: {
      type: String,
      default: '',
      trim: true,
      maxlength: 30
    },
    subject: {
      type: String,
      default: '',
      trim: true,
      maxlength: 120
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000
    },
    source: {
      type: String,
      default: 'web',
      trim: true,
      maxlength: 80
    },
    meta: {
      ip: { type: String, default: '' },
      userAgent: { type: String, default: '' },
      referer: { type: String, default: '' }
    },
    // Links back to VisitorSession.sessionId for funnel/conversion tracking.
    sessionId: { type: String, default: '', index: true }
  },
  {
    timestamps: true
  }
);

contactMessageSchema.index({ createdAt: -1 });
contactMessageSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model('ContactMessage', contactMessageSchema);
