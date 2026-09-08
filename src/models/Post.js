// backend/src/models/Post.js
const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  // Website blog title (can differ from LinkedIn title)
  blogTitle: {
    type: String,
    default: ''
  },
  // LinkedIn post title (optional; LinkedIn is mostly body text)
  linkedInTitle: {
    type: String,
    default: ''
  },
  title: {
    type: String,
    required: true
  },
  // Primary category for the blog
  category: {
    type: String,
    default: 'Technology'
  },
  slug: {
    type: String,
    required: true,
    unique: true
  },
  content: {
    type: String,
    required: true
  },
  excerpt: {
    type: String,
    required: true,
    maxlength: 500
  },
  featuredImage: {
    type: String,
    default: ''
  },
  additionalImages: {
    type: [String],
    default: []
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'published', 'failed'],
    default: 'pending'
  },
  platforms: [{
    type: String,
    enum: ['linkedin', 'blog']
  }],
  sourceNews: {
    title: String,
    url: String,
    source: String,
    publishedAt: Date
  },
  linkedInContent: String,
  rejectionReason: String,
  publishedAt: Date,
  approvedAt: Date,
  rejectedAt: Date,
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {
      categories: ['Technology'],
      tags: [],
      seoScore: 0,
      readabilityScore: 0,
      keywords: [],
      // Per-platform publish metadata
      platformStatus: {
        blog: { status: 'not_published' },
        linkedin: { status: 'not_published' }
      },
      blogPost: {},
      linkedInPost: {}
    }
  },
  authorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  views: {
    type: Number,
    default: 0
  },
  likes: {
    type: Number,
    default: 0
  },
  shares: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Generate slug before saving
postSchema.pre('save', function(next) {
  const baseTitle = this.blogTitle || this.title;
  if ((this.isModified('title') || this.isModified('blogTitle')) && !this.slug) {
    this.slug = baseTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  next();
});

module.exports = mongoose.model('Post', postSchema);