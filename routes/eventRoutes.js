const express = require('express');
const router = express.Router();
const {
  createEvent,
  getAllEvents,
  getMyEvents,
  getPublicEvents,
  updateEvent,
  deleteEvent,
  registerForEvent,
  getEventById,
  getCategories,
  cancelEvent,
} = require('../controllers/eventController');
const { protect, authorize } = require('../middleware/authMiddleware');

const upload = require('../middleware/uploadMiddleware');

// Organizer routes
router.post('/', protect, authorize('organizer'), upload.single('banner'), createEvent);
router.get('/my-events', protect, authorize('organizer'), getMyEvents);

// Admin routes
router.get('/', protect, authorize('admin'), getAllEvents);
router.delete('/:id', protect, authorize('admin', 'organizer'), deleteEvent); // Shared DELETE with check

// User / Shared routes
router.get('/public', protect, getPublicEvents);
router.get('/categories', getCategories);
router.get('/:id', protect, getEventById);
router.put('/:id', protect, authorize('admin', 'organizer'), upload.single('banner'), updateEvent);
router.post('/:id/register', protect, authorize('user'), registerForEvent);
router.patch('/:id/cancel', protect, authorize('admin', 'organizer'), cancelEvent);

module.exports = router;
