const express = require('express');
const router = express.Router();
const { initiateBooking, getMyBookings, stripeWebhook, downloadBooking, getMyTransactions, refundBooking, getMyDashboard } = require('../controllers/bookingController');
const { protect } = require('../middleware/authMiddleware');

router.post('/checkout/:eventId', protect, initiateBooking);
router.get('/my-dashboard', protect, getMyDashboard);
router.get('/my-tickets', protect, getMyBookings);
router.get('/my-transactions', protect, getMyTransactions);
router.post('/:id/refund', protect, refundBooking);
router.get('/:id/download', protect, downloadBooking);

module.exports = router;
