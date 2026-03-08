const express = require('express');
const router = express.Router();
const { getMyTickets, downloadTicket } = require('../controllers/ticketController');
const { protect } = require('../middleware/authMiddleware');

router.get('/my-tickets', protect, getMyTickets);
router.get('/:id/download', protect, downloadTicket);

module.exports = router;
