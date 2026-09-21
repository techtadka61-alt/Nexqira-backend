// backend/src/models/PostLike.js
// One document per (post, visitor) pair. No TTL — a like persists until the
// visitor explicitly unlikes (document is deleted), which also lets us
// answer "has this visitor already liked this post?" for the toggle UI.
const mongoose = require('mongoose');

const postLikeSchema = new mongoose.Schema({
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
  likedAt: {
    type: Date,
    default: Date.now
  }
});

postLikeSchema.index({ postId: 1, visitorHash: 1 }, { unique: true });

module.exports = mongoose.model('PostLike', postLikeSchema);
