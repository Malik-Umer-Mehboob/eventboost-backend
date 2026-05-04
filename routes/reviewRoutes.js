const express = require('express');
const router = express.Router();
const {
  submitReview,
  getEventReviews,
  getOrganizerReviews,
  getMyReview,
  updateReview,
  deleteReview,
} = require('../controllers/reviewController');
const { protect } = require('../middleware/authMiddleware');

// Public routes
router.get('/event/:eventId', getEventReviews);
router.get('/organizer/:organizerId', getOrganizerReviews);

// Protected routes
router.get('/my-review/:eventId', protect, getMyReview);
router.post('/:eventId', protect, submitReview);
router.put('/:reviewId', protect, updateReview);
router.delete('/:reviewId', protect, deleteReview);

module.exports = router;
