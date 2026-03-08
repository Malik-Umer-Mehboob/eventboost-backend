const User = require('../models/User');
const Event = require('../models/Event');
const Booking = require('../models/Booking');
const Transaction = require('../models/Transaction');
const Ticket = require('../models/Ticket');
const bcrypt = require('bcryptjs');
const Stripe = require('stripe');
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

if (!stripe) {
  console.warn('⚠️ Warning: STRIPE_SECRET_KEY is missing from environment variables. Stripe features will be disabled.');
}
const nodemailer = require('nodemailer');
const { broadcastEmergencyAlert, broadcastEventUpdate } = require('../config/socket');
const { notifyMany, createNotification } = require('../services/notificationService');

// @desc    Create a new Organizer
// @route   POST /api/admin/create-organizer
// @access  Private/Admin
const createOrganizer = async (req, res) => {
  const { name, email, password } = req.body;

  try {
    if (!email.endsWith('@yahoo.com')) {
      return res.status(400).json({ message: 'Organizer email must be a @yahoo.com address' });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await User.create({ name, email, password, role: 'organizer' });

    if (user) {
      res.status(201).json({ _id: user.id, name: user.name, email: user.email, role: user.role });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Email already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get Admin Dashboard with analytics
// @route   GET /api/admin/dashboard?from=&to=
// @access  Private/Admin
const getAdminDashboard = async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter = from && to
      ? { createdAt: { $gte: new Date(from), $lte: new Date(to) } }
      : {};

    const [
      userCount,
      organizerCount,
      eventCount,
      revenueResult,
      ticketsSoldResult,
      recentBookings,
      monthlySales,
      categoryBreakdown
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'organizer' }),
      Event.countDocuments(),

      // Total platform revenue from succeeded transactions
      Transaction.aggregate([
        { $match: { status: 'succeeded', ...dateFilter } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),

      // Total tickets sold from paid bookings
      Booking.aggregate([
        { $match: { paymentStatus: 'paid', ...dateFilter } },
        { $group: { _id: null, total: { $sum: '$quantity' } } }
      ]),

      // Recent activity feed — latest 10 paid bookings
      Booking.find({ paymentStatus: 'paid', ...dateFilter })
        .sort('-createdAt')
        .limit(10)
        .populate('user', 'name email')
        .populate('event', 'title date')
        .lean(),

      // Monthly revenue trend for last 6 months
      Transaction.aggregate([
        { $match: { status: 'succeeded' } },
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            revenue: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
        { $limit: 6 }
      ]),

      // Tickets sold by event category
      Booking.aggregate([
        { $match: { paymentStatus: 'paid' } },
        {
          $lookup: {
            from: 'events',
            localField: 'event',
            foreignField: '_id',
            as: 'eventDoc'
          }
        },
        { $unwind: '$eventDoc' },
        {
          $group: {
            _id: '$eventDoc.category',
            tickets: { $sum: '$quantity' },
            revenue: { $sum: '$totalAmount' }
          }
        },
        { $sort: { revenue: -1 } }
      ])
    ]);

    res.status(200).json({
      stats: {
        users: userCount,
        organizers: organizerCount,
        events: eventCount,
        revenue: revenueResult[0]?.total || 0,
        ticketsSold: ticketsSoldResult[0]?.total || 0
      },
      recentBookings,
      monthlySales: monthlySales.map(m => ({
        name: new Date(m._id.year, m._id.month - 1).toLocaleString('default', { month: 'short' }),
        revenue: m.revenue,
        bookings: m.count
      })),
      categoryBreakdown
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get All Transactions
// @route   GET /api/admin/transactions
// @access  Private/Admin
const getAllTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({})
      .populate('user', 'name email')
      .populate('event', 'title')
      .sort('-createdAt');
    res.status(200).json(transactions);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Emergency / platform broadcast
// @route   POST /api/admin/broadcast
// @access  Private/Admin
const broadcastEmergency = async (req, res) => {
  try {
    const { title, content, eventId, targetRole } = req.body;
    if (!title || !content) {
      return res.status(400).json({ message: 'title and content are required' });
    }

    // Determine target socket rooms
    const rooms = [];
    if (eventId) rooms.push(`event_${eventId}`);
    if (targetRole) rooms.push(`role_${targetRole}`);
    
    console.log('📡 Admin Broadcast Request:', { title, content, eventId, targetRole, rooms });

    // Broadcast via WebSocket (rooms=[] means platform-wide)
    broadcastEmergencyAlert({ title, content, eventId: eventId || null }, rooms);

    // Persist as notifications
    const notificationData = {
      type: 'announcement',
      title,
      message: content,
      event: eventId || null,
      sender: req.user._id,
      idempotencyKeyBase: `emergency-${eventId || 'platform'}-${Date.now()}`
    };

    if (eventId) {
      const bookings = await Booking.find({ event: eventId, paymentStatus: 'paid' }).select('user').lean();
      const recipientIds = bookings.map(b => b.user);
      if (recipientIds.length > 0) {
        await notifyMany(recipientIds, notificationData);
      }
    } else {
      // Platform-wide persistence: notify all active users
      // Note: for very large apps, this would be a background job.
      // For this scale, we'll notify all users in the DB
      const users = await User.find({ role: { $ne: 'admin' } }).select('_id').lean();
      const recipientIds = users.map(u => u._id);
      if (recipientIds.length > 0) {
        // Send in batches to avoid overwhelming memory/connections
        const batchSize = 100;
        for (let i = 0; i < recipientIds.length; i += batchSize) {
          const batch = recipientIds.slice(i, i + batchSize);
          await notifyMany(batch, notificationData);
        }
      }
    }

    res.json({ message: 'Emergency alert broadcast successfully' });
  } catch (error) {
    console.error('Broadcast emergency error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Cancel an event and refund all tickets
// @route   PUT /api/admin/events/:id/cancel
// @access  Private/Admin
const cancelEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (event.status === 'cancelled') {
      return res.status(400).json({ message: 'Event is already cancelled' });
    }

    // Update event status
    event.status = 'cancelled';
    await event.save();

    // Find all tickets for this event
    const tickets = await Ticket.find({ event: event._id }).populate('user');

    const refundResults = {
      total: tickets.length,
      refunded: 0,
      failed: 0,
      skipped: 0
    };

    // Identify unique payment intents to avoid redundant refunds
    const uniquePaymentIntents = new Set();
    for (const ticket of tickets) {
      if (ticket.refundStatus !== 'refunded') {
        let pi = ticket.paymentIntentId;
        if (!pi) {
            const transaction = await Transaction.findOne({ 
                event: event._id, 
                user: ticket.user._id,
                status: 'succeeded' 
            });
            if (transaction) pi = transaction.stripePaymentIntentId;
        }
        if (pi) uniquePaymentIntents.add(pi);
      } else {
        refundResults.skipped++;
      }
    }

    console.log(`🔍 Found ${uniquePaymentIntents.size} unique payment intents to refund.`);

    if (!stripe) {
      return res.status(500).json({ message: 'Stripe is not configured. Cannot process refunds.' });
    }

    for (const pi of uniquePaymentIntents) {
      try {
        await stripe.refunds.create({ payment_intent: pi });
        refundResults.refunded++;
      } catch (stripeError) {
        console.error(`Refund failed for PI ${pi}:`, stripeError.message);
        refundResults.failed++;
      }
    }

    // Broadcast event cancellation (the webhook will handle individual booking rollbacks)
    broadcastEventUpdate(event.toObject(), 'cancelled');

    res.json({ 
      message: 'Event cancelled and refunds processed', 
      results: refundResults 
    });

  } catch (error) {
    console.error('Cancel event error:', error);
    res.status(500).json({ message: 'Server error during event cancellation' });
  }
};

// @desc    Approve a resubmitted event
// @route   PATCH /api/admin/events/:id/approve
// @access  Private/Admin
const approveEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    event.status = 'active';
    await event.save();

    // Notify organizer
    await createNotification({
      user: event.organizer || event.createdBy,
      type: 'event_update',
      title: 'Event Approved',
      message: `Your event "${event.title}" has been approved and is now active.`,
      link: `/events/${event._id}`
    });

    broadcastEventUpdate({ ...event.toObject(), action: 'updated' });
    res.json({ message: 'Event approved successfully', event });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Edit any event
// @route   PATCH /api/admin/events/:id
// @access  Private/Admin
const adminEditEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    // Prevent sensitivity issues
    delete updates.createdBy;
    delete updates.organizer;

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Reset status to active if it was cancelled, unless explicitly changed
    if (event.status === 'cancelled' && !updates.status) {
      updates.status = 'resubmitted'; // Admin edit of cancelled event implicitly resubmits if not set to active
    }

    if (req.file) {
      // Delete old banner if exists
      if (event.bannerImage && event.bannerImage.public_id) {
        try {
          await require('../config/cloudinary').uploader.destroy(event.bannerImage.public_id);
        } catch (e) {
          console.warn('Cloudinary image deletion failed:', e.message);
        }
      }
      updates.bannerImage = { url: req.file.path, public_id: req.file.filename };
    } else if (req.body.bannerImage && typeof req.body.bannerImage === 'string') {
      updates.bannerImage = { url: req.body.bannerImage };
    }

    const updatedEvent = await Event.findByIdAndUpdate(id, updates, { 
      returnDocument: 'after', 
      runValidators: true 
    });

    broadcastEventUpdate({ ...updatedEvent.toObject(), action: 'updated' });
    res.json(updatedEvent);
  } catch (error) {
    console.error('Admin edit event error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Delete any event
// @route   DELETE /api/admin/events/:id
// @access  Private/Admin
const adminDeleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Delete banner from Cloudinary if exists
    if (event.bannerImage && event.bannerImage.public_id) {
      try {
        await require('../config/cloudinary').uploader.destroy(event.bannerImage.public_id);
      } catch (e) {
        console.warn('Cloudinary image deletion failed:', e.message);
      }
    }

    await Event.findByIdAndDelete(id);
    broadcastEventUpdate({ _id: id, action: 'deleted' });
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Admin delete event error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get All Organizers with their event counts
// @route   GET /api/admin/organizers
// @access  Private/Admin
const getAllOrganizers = async (req, res) => {
  try {
    const organizers = await User.aggregate([
      { $match: { role: 'organizer' } },
      {
        $lookup: {
          from: 'events',
          localField: '_id',
          foreignField: 'organizer',
          as: 'events'
        }
      },
      {
        $project: {
          name: 1,
          email: 1,
          createdAt: 1,
          status: 1,
          eventCount: { $size: '$events' }
        }
      },
      { $sort: { createdAt: -1 } }
    ]);

    res.status(200).json({
      total: organizers.length,
      organizers
    });
  } catch (error) {
    console.error('Get all organizers error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update Organizer details
// @route   PUT /api/admin/organizers/:id
// @access  Private/Admin
const updateOrganizer = async (req, res) => {
  try {
    const { name, status } = req.body;
    const organizer = await User.findById(req.params.id);

    if (!organizer || organizer.role !== 'organizer') {
      return res.status(404).json({ message: 'Organizer not found' });
    }

    if (name) organizer.name = name;
    if (status) organizer.status = status;

    await organizer.save();

    res.json({
      _id: organizer._id,
      name: organizer.name,
      email: organizer.email,
      status: organizer.status,
      role: organizer.role
    });
  } catch (error) {
    console.error('Update organizer error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Delete Organizer and their events
// @route   DELETE /api/admin/organizers/:id
// @access  Private/Admin
const deleteOrganizer = async (req, res) => {
  try {
    const organizer = await User.findById(req.params.id);

    if (!organizer || organizer.role !== 'organizer') {
      return res.status(404).json({ message: 'Organizer not found' });
    }

    // Delete all events created by this organizer
    // Note: cascading deletion of bookings/tickets might be needed depending on business rules.
    // The requirement says: "Optionally delete related events OR reassign them. Must: Remove organizer from DB, Clean up related data (events, bookings if needed)"
    
    // Find events to clean up images and bookings
    const events = await Event.find({ organizer: organizer._id });
    
    for (const event of events) {
        // Here we could call some cleanup logic if it exists, 
        // but for now we follow the "Must remove" rule.
        // We'll delete bookings and tickets associated with these events.
        await Booking.deleteMany({ event: event._id });
        await Ticket.deleteMany({ event: event._id });
        
        // Delete banner from Cloudinary
        if (event.bannerImage && event.bannerImage.public_id) {
            try {
                await require('../config/cloudinary').uploader.destroy(event.bannerImage.public_id);
            } catch (e) {
                console.warn('Cloudinary image deletion failed for event:', event._id, e.message);
            }
        }
    }

    await Event.deleteMany({ organizer: organizer._id });
    await User.findByIdAndDelete(req.params.id);

    res.json({ message: 'Organizer and all related data deleted successfully' });
  } catch (error) {
    console.error('Delete organizer error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const sendRefundEmail = async (user, event) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: `Refund Processed: ${event.title} has been cancelled`,
      text: `Hi ${user.name},\n\nWe're sorry to inform you that the event "${event.title}" has been cancelled.\n\nA full refund for your tickets has been processed via Stripe. Please allow 5-10 business days for the funds to appear in your account.\n\nEvent Details:\nDate: ${new Date(event.date).toLocaleString()}\nLocation: ${event.location}\n\nWe apologize for any inconvenience.\n\nBest regards,\nThe EventBoost Pro Team`,
    });
  } catch (error) {
    console.error('Error sending refund email:', error);
  }
};

module.exports = {
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
  deleteOrganizer,
};
