const express = require('express');
const { protect, admin } = require('../middleware/auth');
const { sendApprovalEmail, handleApprovalLink } = require('../controllers/adminController');

const router = express.Router();

router.post('/posts/:id/send-approval-email', protect, admin, sendApprovalEmail);

// Public, token-based approve/reject links (for Gmail)
router.get('/approval/:token', handleApprovalLink);

module.exports = router;
