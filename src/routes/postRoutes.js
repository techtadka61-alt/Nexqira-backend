const express = require('express');
const {
  getPosts,
  getPost,
  approvePost,
  rejectPost,
  createPost,
  getStats,
  updatePost,
  publishPost,
  unpublishPost,
  deletePost,
} = require('../controllers/postController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

router.get('/', protect, admin, getPosts);
router.get('/stats', protect, admin, getStats);
router.get('/:id', protect, admin, getPost);
router.post('/', protect, admin, createPost);
router.put('/:id', protect, admin, updatePost);
router.delete('/:id', protect, admin, deletePost);
router.put('/:id/approve', protect, admin, approvePost);
router.put('/:id/reject', protect, admin, rejectPost);
router.post('/:id/publish', protect, admin, publishPost);
router.post('/:id/unpublish', protect, admin, unpublishPost);

module.exports = router;