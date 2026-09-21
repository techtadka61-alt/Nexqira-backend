// backend/src/models/PostView.js
// One document per (post, visitor) pair. The TTL index below expires a view
// record 24h after it was created, so a returning visitor after that window
// counts as a fresh view again (matches the "unique per day-ish" requirement
// without needing a separate day-bucket field).
const mongoose = require('mongoose');

const postViewSchema = new mongoose.Schema({
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true,
    index: true
  },
  visitorHash: {
    type: String,
    required: true
  },
  viewedAt: {
    type: Date,
    default: Date.now
  }
});

postViewSchema.index({ postId: 1, visitorHash: 1 }, { unique: true });
postViewSchema.index({ viewedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

module.exports = mongoose.model('PostView', postViewSchema);
