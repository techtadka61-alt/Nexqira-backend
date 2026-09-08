// backend/src/routes/blogRoutes.js
const express = require('express');
const {
  getWebsitePosts,
  getWebsitePostBySlug,
  getRelatedPosts,
  getBlogMetadata
} = require('../controllers/blogController');

const router = express.Router();

// Public routes for website (no authentication needed)
router.get('/posts', getWebsitePosts);
router.get('/posts/:slug', getWebsitePostBySlug);
router.get('/posts/:postId/related', getRelatedPosts);
router.get('/metadata', getBlogMetadata);

module.exports = router;