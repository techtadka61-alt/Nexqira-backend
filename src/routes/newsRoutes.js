const express = require('express');
const { 
  generateNewsPost, 
  generateBatchNews,
  testGrokAPI 
} = require('../controllers/newsController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

router.post('/generate', protect, admin, generateNewsPost);
router.post('/generate-batch', protect, admin, generateBatchNews);
router.get('/test-grok', protect, admin, testGrokAPI);

module.exports = router;