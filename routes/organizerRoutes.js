const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { announcementLimiter } = require('../middleware/rateLimiter');
const { getMyEvents, sendAnnouncement, getOrganizerDashboard, getEventAttendees } = require('../controllers/eventController');
const { getOrganizerProfile, updateOrganizerProfile } = require('../controllers/organizerController');

// @desc    Get Organizer Profile
// @route   GET /api/organizers/profile
// @access  Private/Organizer
router.get('/profile', protect, authorize('organizer'), getOrganizerProfile);

// @desc    Update Organizer Profile (name only)
// @route   PATCH /api/organizers/profile
// @access  Private/Organizer
router.patch('/profile', protect, authorize('organizer'), updateOrganizerProfile);

// @desc    Get Organizer Analytics Dashboard
// @route   GET /api/organizers/analytics
// @access  Private/Organizer
router.get('/analytics', protect, authorize('organizer'), getOrganizerDashboard);

// @desc    Get Organizer's Events
// @route   GET /api/organizers/events
// @access  Private/Organizer
router.get('/events', protect, authorize('organizer'), getMyEvents);

// @desc    Get attendees for a specific event (paginated)
// @route   GET /api/organizers/events/:id/attendees
// @access  Private/Organizer/Admin
router.get('/events/:id/attendees', protect, authorize('organizer', 'admin'), getEventAttendees);

// @desc    Send Announcement for an Event
// @route   POST /api/organizers/events/:id/announce
// @access  Private/Organizer/Admin
router.post('/events/:id/announce', protect, authorize('organizer', 'admin'), announcementLimiter, sendAnnouncement);

module.exports = router;
