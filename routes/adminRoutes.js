const express = require('express');
const router = express.Router();
const { 
  createOrganizer, 
  getAdminDashboard, 
  getAllTransactions, 
  broadcastEmergency, 
  cancelEvent,
  approveEvent,
  adminEditEvent,
  adminDeleteEvent,
  getAllOrganizers,
  updateOrganizer,
  deleteOrganizer
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.post('/create-organizer', protect, authorize('admin'), createOrganizer);
router.get('/dashboard', protect, authorize('admin'), getAdminDashboard);
router.get('/transactions', protect, authorize('admin'), getAllTransactions);
router.post('/broadcast', protect, authorize('admin'), broadcastEmergency);
router.put('/events/:id/cancel', protect, authorize('admin'), cancelEvent);
router.patch('/events/:id/approve', protect, authorize('admin'), approveEvent);
router.patch('/events/:id', protect, authorize('admin'), upload.single('banner'), adminEditEvent);
router.delete('/events/:id', protect, authorize('admin'), adminDeleteEvent);

// Organizer Management
router.get('/organizers', protect, authorize('admin'), getAllOrganizers);
router.put('/organizers/:id', protect, authorize('admin'), updateOrganizer);
router.delete('/organizers/:id', protect, authorize('admin'), deleteOrganizer);

module.exports = router;
