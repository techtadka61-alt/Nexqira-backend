const express = require('express');
const { searchUnsplash } = require('../controllers/imageController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

// Admin-only: keep Unsplash key server-side
router.get('/unsplash', protect, admin, searchUnsplash);

module.exports = router;
