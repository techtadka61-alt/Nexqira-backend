const express = require('express');
const { uploadSingleImage, handleUploadImage } = require('../controllers/uploadController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

const wrapUpload = (req, res, next) => {
  uploadSingleImage(req, res, (err) => {
    if (err) {
      console.error('Image upload failed:', err);
      return res.status(400).json({ message: err.message || 'Image upload failed' });
    }
    next();
  });
};

router.post('/image', protect, admin, wrapUpload, handleUploadImage);

module.exports = router;
