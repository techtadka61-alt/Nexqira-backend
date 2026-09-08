// backend/src/models/Log.js
const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  level: {
    type: String,
    enum: ['info', 'warn', 'error', 'debug'],
    required: true
  },
  message: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['system', 'news', 'ai', 'image', 'linkedin', 'blog', 'auth', 'scheduler'],
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 2592000 // 30 days TTL
  }
});

// Index for better query performance
logSchema.index({ category: 1, createdAt: -1 });
logSchema.index({ level: 1, createdAt: -1 });
logSchema.index({ postId: 1, createdAt: -1 });

module.exports = mongoose.model('Log', logSchema);