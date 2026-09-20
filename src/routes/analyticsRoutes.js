const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  trackVisit,
  trackSession,
  trackPageView,
  trackPageExit,
  getMonthlyStats,
  getVisitors,
  getVisitor,
  getVisitorSessions,
  getVisitorJourney,
  getOverview,
  getGeoBreakdown,
  getTimeseries,
  getPagesAndSources,
  getFunnel
} = require('../controllers/analyticsController');
const { exportAnalytics } = require('../controllers/analyticsExportController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

// Page views fire on every route change, so they need a higher ceiling than trackLimiter.
const pageViewLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
});

// Public: called from the website to record an anonymous visit
router.post('/track', trackLimiter, trackVisit);
router.post('/session', trackLimiter, trackSession);
router.post('/pageview', pageViewLimiter, trackPageView);
// sendBeacon has no way to set a custom header, and fires during unload where a browser may
// not run the fetch keepalive fallback consistently, so give it its own generous limiter.
router.post('/pageview/exit', pageViewLimiter, trackPageExit);

// Admin: visitor stats (legacy, IP-keyed)
router.get('/visitors/monthly', protect, admin, getMonthlyStats);
router.get('/visitors', protect, admin, getVisitors);
router.get('/visitors/:id', protect, admin, getVisitor);

// Admin: session-based visitor footprint (entry/exit page, per-page duration)
router.get('/sessions', protect, admin, getVisitorSessions);
router.get('/sessions/:sessionId/journey', protect, admin, getVisitorJourney);

// Admin: dashboard v2 (session-based)
router.get('/overview', protect, admin, getOverview);
router.get('/geo', protect, admin, getGeoBreakdown);
router.get('/timeseries', protect, admin, getTimeseries);
router.get('/pages-sources', protect, admin, getPagesAndSources);
router.get('/funnel', protect, admin, getFunnel);
router.get('/export', protect, admin, exportAnalytics);

module.exports = router;
