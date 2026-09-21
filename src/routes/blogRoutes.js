// backend/src/routes/blogRoutes.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  getWebsitePosts,
  getWebsitePostBySlug,
  getRelatedPosts,
  getBlogMetadata,
  toggleLike
} = require('../controllers/blogController');

const router = express.Router();

// Basic abuse protection on the like toggle (it's a write endpoint, unlike
// the rest of this router's read-only routes).
const likeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

// Public routes for website (no authentication needed)
router.get('/posts', getWebsitePosts);
router.get('/posts/:slug', getWebsitePostBySlug);
router.get('/posts/:postId/related', getRelatedPosts);
router.post('/posts/:slug/like', likeLimiter, toggleLike);
router.get('/metadata', getBlogMetadata);

module.exports = router;