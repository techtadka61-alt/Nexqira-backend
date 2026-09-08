const express = require('express');
const { uploadSingleImage, handleUploadImage } = require('../controllers/uploadController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

router.post('/image', protect, admin, uploadSingleImage, handleUploadImage);

module.exports = router;
