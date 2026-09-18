const mongoose = require('mongoose');

const chatLeadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: '',
      trim: true,
      maxlength: 80
    },
    email: {
      type: String,
      default: '',
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
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000
    },
    conversation: [
      {
        role: {
          type: String,
          enum: ['user', 'assistant'],
          required: true
        },
        content: {
          type: String,
          required: true,
          trim: true,
          maxlength: 2000
        }
      }
    ],
    source: {
      type: String,
      default: 'chatbot',
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

chatLeadSchema.index({ createdAt: -1 });
chatLeadSchema.index({ email: 1, phone: 1, createdAt: -1 });

module.exports = mongoose.model('ChatLead', chatLeadSchema);
