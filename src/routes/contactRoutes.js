const express = require('express');
const rateLimit = require('express-rate-limit');
const { submitContact } = require('../controllers/contactController');

const router = express.Router();

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/', contactLimiter, submitContact);

module.exports = router;
