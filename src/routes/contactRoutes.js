const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  submitContact,
  getContacts,
  getContact,
  deleteContact,
  getContactStats
} = require('../controllers/contactController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/', contactLimiter, submitContact);

// Admin routes
router.get('/', protect, admin, getContacts);
router.get('/stats', protect, admin, getContactStats);
router.get('/:id', protect, admin, getContact);
router.delete('/:id', protect, admin, deleteContact);

module.exports = router;
