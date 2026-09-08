const express = require('express');
const rateLimit = require('express-rate-limit');
const { sendMessage } = require('../controllers/chatbotController');

const router = express.Router();

const chatbotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/message', chatbotLimiter, sendMessage);

module.exports = router;
