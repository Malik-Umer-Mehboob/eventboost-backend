const express = require('express');
const router = express.Router();
const { 
  joinWaitlist, 
  leaveWaitlist, 
  getUserPosition, 
  getEventWaitlist,
  getMyWaitlist 
} = require('../controllers/waitlistController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.post('/join/:eventId', protect, joinWaitlist);
router.delete('/leave/:eventId', protect, leaveWaitlist);
router.get('/my-waitlist', protect, getMyWaitlist);
router.get('/position/:eventId', protect, getUserPosition);
router.get('/:eventId', protect, authorize('admin', 'organizer'), getEventWaitlist);

module.exports = router;
