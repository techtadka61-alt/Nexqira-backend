const express = require('express');
const rateLimit = require('express-rate-limit');
const { trackVisit, getMonthlyStats } = require('../controllers/analyticsController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

// Public: called from the website to record an anonymous visit
router.post('/track', trackLimiter, trackVisit);

// Admin: visitor stats
router.get('/visitors/monthly', protect, admin, getMonthlyStats);

module.exports = router;
