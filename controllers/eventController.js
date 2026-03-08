const Event = require('../models/Event');
const { notifyMany, createNotification } = require('../services/notificationService');
const { sendBatchEmails } = require('../services/emailService');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Transaction = require('../models/Transaction');
const Ticket = require('../models/Ticket');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { broadcastEventUpdate, broadcastEmergencyAlert } = require('../config/socket');

const CATEGORIES = [
  'Conference',
  'Workshop',
  'Seminar',
  'Party',
  'Concert',
  'Exhibition',
  'Sports',
  'Others',
];

// @desc    Create a new event
// @route   POST /api/events
// @access  Private (Organizer only)
const createEvent = async (req, res) => {
  try {
    const { 
      title, 
      description, 
      date, 
      location, 
      category, 
      ticketPrice, 
      ticketQuantity, 
      bannerImage, 
      isFeatured 
    } = req.body;

    // Validate category
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ message: 'Invalid category' });
    }

    // Check for duplicate event (same title, date, and organizer)
    const duplicate = await Event.findOne({
      title: title,
      date: new Date(date),
      organizer: req.user.id
    });

    if (duplicate) {
      return res.status(400).json({ message: 'You have already created an event with this title and date.' });
    }

    let bannerData = {};
    if (req.file) {
      bannerData = { url: req.file.path, public_id: req.file.filename };
    } else if (bannerImage && typeof bannerImage === 'string') {
      bannerData = { url: bannerImage };
    }

    const event = await Event.create({
      title,
      description,
      date,
      location,
      category,
      ticketPrice,
      ticketQuantity,
      bannerImage: bannerData,
      isFeatured,
      organizer: req.user.id,
      createdBy: req.user.id,
    });

    broadcastEventUpdate({ ...event.toObject(), action: 'created' });
    res.status(201).json(event);
  } catch (error) {
    console.error('Error in createEvent:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get all events
// @route   GET /api/events
// @access  Private (Admin only)
const getAllEvents = async (req, res) => {
  try {
    const events = await Event.find({}).populate('organizer createdBy', 'name email');
    res.json(events);
  } catch (error) {
    console.error('Error in getAllEvents:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get organizer's events
// @route   GET /api/events/my-events
// @access  Private (Organizer only)
const getMyEvents = async (req, res) => {
  try {
    const events = await Event.find({ 
      $or: [{ organizer: req.user.id }, { createdBy: req.user.id }] 
    }).populate('organizer createdBy', 'name email');
    res.json(events);
  } catch (error) {
    console.error('Error in getMyEvents:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get public events (all users)
// @route   GET /api/events/public
// @access  Private
const getPublicEvents = async (req, res) => {
  try {
    const events = await Event.find({}).populate('organizer createdBy', 'name');
    res.json(events);
  } catch (error) {
    console.error('Error in getPublicEvents:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update event
// @route   PUT /api/events/:id
// @access  Private (Organizer/Admin)
const updateEvent = async (req, res) => {
  try {
    const { category } = req.body;

    // Validate category if provided
    if (category && !CATEGORIES.includes(category)) {
      return res.status(400).json({ message: 'Invalid category' });
    }

    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check ownership or admin status
    // Safe check: Admins can update any event. Organizers can update only theirs.
    const organizerId = event.organizer || event.createdBy;
    const isOwner = organizerId && organizerId.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized to update this event' });
    }

    const updateData = { ...req.body };

    // Sanitize updateData: Prevent overwriting sensitive fields or fields that might cause casting errors
    // (e.g., if frontend sends back populated objects)
    // Prevent organizers from changing protected fields
    delete updateData.organizer;
    delete updateData.createdBy;
    delete updateData.attendees;
    
    // Status Logic: Only admins can manually set status to 'active'.
    // If an organizer updates a cancelled event, it becomes 'resubmitted'.
    let isResubmitted = false;
    if (event.status === 'cancelled') {
        updateData.status = 'resubmitted';
        isResubmitted = true;
    } else {
        delete updateData.status; // Organizer cannot manually change status of active events
    }

    if (req.file) {
      // Delete old banner if exists
      if (event.bannerImage && event.bannerImage.public_id) {
        await require('../config/cloudinary').uploader.destroy(event.bannerImage.public_id);
      }
      updateData.bannerImage = { url: req.file.path, public_id: req.file.filename };
    } else if (req.body.bannerImage && typeof req.body.bannerImage === 'string') {
        updateData.bannerImage = { url: req.body.bannerImage };
    }

    const updatedEvent = await Event.findByIdAndUpdate(req.params.id, updateData, {
      returnDocument: 'after',
      runValidators: true,
    });

    broadcastEventUpdate({ ...updatedEvent.toObject(), action: 'updated' });
    res.json(updatedEvent);

    // Notify admins if resubmitted
    if (isResubmitted) {
      const admins = await User.find({ role: 'admin' }).select('_id');
      if (admins.length > 0) {
        await notifyMany(admins.map(a => a._id), {
          type: 'event_update',
          title: 'Event Resubmitted',
          message: `Organizer has resubmitted "${updatedEvent.title}" for approval.`,
          link: `/events/${updatedEvent._id}`,
          event: updatedEvent._id
        });
      }
    }

    // Notify registered attendees if there are any
    if (updatedEvent.attendees && updatedEvent.attendees.length > 0) {
      const attendees = await User.find({ _id: { $in: updatedEvent.attendees } });
      const attendeeEmails = attendees.map(u => u.email);

      // Send Batch Emails
      await sendBatchEmails(attendeeEmails, {
        subject: `Update: ${updatedEvent.title} has been updated`,
        html: `
          <h1>Event Updated</h1>
          <p>Hi,</p>
          <p>The event <strong>${updatedEvent.title}</strong> has been updated. Please check the new details.</p>
          <a href="${process.env.FRONTEND_URL}/events/${updatedEvent._id}">View Event Details</a>
        `,
        type: 'event_update',
        eventId: updatedEvent._id
      });

      // Send In-App Notifications
      await notifyMany(updatedEvent.attendees, {
        type: 'event_update',
        title: 'Event Update',
        message: `"${updatedEvent.title}" has been updated.`,
        link: `/events/${updatedEvent._id}`,
        event: updatedEvent._id
      });
    }
  } catch (error) {
    console.error('Error in updateEvent:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete event
// @route   DELETE /api/events/:id
// @access  Private (Organizer/Admin)
const deleteEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check ownership or admin status
    // Safe check: Admins can delete any event. Organizers can delete only theirs.
    const organizerId = event.organizer || event.createdBy;
    const isOwner = organizerId && organizerId.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized to delete this event' });
    }

    // Notify registered attendees before deletion
    if (event.attendees && event.attendees.length > 0) {
      const attendees = await User.find({ _id: { $in: event.attendees } });
      const attendeeEmails = attendees.map(u => u.email);

      await sendBatchEmails(attendeeEmails, {
        subject: `Cancellation: ${event.title} has been cancelled`,
        html: `
          <h1>Event Cancelled</h1>
          <p>Hi,</p>
          <p>We regret to inform you that the event <strong>${event.title}</strong> has been cancelled by the organizer.</p>
          <p>If you purchased a ticket, a refund will be processed shortly.</p>
        `,
        type: 'event_update',
        eventId: event._id
      });

      await notifyMany(event.attendees, {
        type: 'event_update',
        title: 'Event Cancelled',
        message: `"${event.title}" has been cancelled.`,
        event: event._id
      });
    }

    // 3. Cascade Delete: Remove associated bookings and tickets
    console.log(`🧹 Cascading delete for event ${event._id}...`);
    await Promise.all([
      Booking.deleteMany({ event: event._id }),
      Ticket.deleteMany({ event: event._id })
    ]);

    // Delete banner from Cloudinary if exists
    if (event.bannerImage && event.bannerImage.public_id) {
      await require('../config/cloudinary').uploader.destroy(event.bannerImage.public_id);
    }

    await event.deleteOne();
    broadcastEventUpdate({ _id: req.params.id, action: 'deleted' });
    res.json({ message: 'Event removed' });
  } catch (error) {
    console.error('Error in deleteEvent:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Register for an event
// @route   POST /api/events/:id/register
// @access  Private (User only)
const registerForEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check if user already registered
    if (event.attendees.includes(req.user.id)) {
      return res.status(400).json({ message: 'Already registered for this event' });
    }

    event.attendees.push(req.user.id);
    await event.save();

    res.json({ message: 'Successfully registered' });
  } catch (error) {
    console.error('Error in registerForEvent:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get single event
// @route   GET /api/events/:id
// @access  Private
const getEventById = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).populate('organizer createdBy', 'name email');

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    res.json(event);
  } catch (error) {
    console.error('Error in getEventById:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get event categories
// @route   GET /api/events/categories
// @access  Public
const getCategories = (req, res) => {
  res.json(CATEGORIES);
};

const sendAnnouncement = async (req, res) => {
  try {
    const { title, message } = req.body;
    
    if (!title || !message) {
      return res.status(400).json({ message: 'Title and message are required' });
    }

    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check ownership
    const organizerId = event.organizer || event.createdBy;
    if (!organizerId || (organizerId.toString() !== req.user.id && req.user.role !== 'admin')) {
      return res.status(403).json({ message: 'Not authorized to send announcements for this event' });
    }

    // Ensure we have unique attendees (and they are strings)
    // We fetch from TWO sources to be absolutely safe:
    // 1. The denormalized event.attendees array
    // 2. The Booking collection (source of truth for paid tickets)
    const BookingModel = require('../models/Booking');
    const paidBookings = await BookingModel.find({ 
      event: event._id, 
      paymentStatus: 'paid', 
      refundStatus: 'none' 
    }).select('user').lean();
    
    const bookingRecipientIds = paidBookings.map(b => b.user.toString());
    const eventAttendeeIds = (event.attendees || []).map(id => id.toString());
    
    const uniqueAttendeeIds = [...new Set([...bookingRecipientIds, ...eventAttendeeIds])];

    if (uniqueAttendeeIds.length === 0) {
      return res.status(400).json({ message: 'No registered attendees to notify' });
    }

    console.log(`📣 Sending announcement for "${event.title}" to ${uniqueAttendeeIds.length} attendees...`);

    // Fetch attendee profiles to get emails
    const attendees = await User.find({ _id: { $in: uniqueAttendeeIds } }).select('email').lean();
    const attendeeEmails = attendees.map(u => u.email).filter(Boolean);
    
    // Add organizer/admin to the BCC or separate send if needed, but here we just add to the list
    const senderEmail = req.user.email;
    if (senderEmail && !attendeeEmails.includes(senderEmail)) {
      attendeeEmails.push(senderEmail);
    }

    // Standardize notification data
    const notificationData = {
      type: 'announcement',
      title: `Announcement: ${title}`,
      message,
      link: `/events/${event._id}`,
      event: event._id,
      sender: req.user.id,
      idempotencyKeyBase: `announcement-${event._id}-${Date.now()}`
    };

    // 1. Send In-App Notifications & Socket Alerts (Synchronous/Awaited for immediate feedback)
    const savedNotifications = await notifyMany(uniqueAttendeeIds, notificationData);
    
    // 2. Broadcast live alert via Socket.IO
    const targetRooms = [`event_${event._id}`, `user_${req.user.id}`];
    uniqueAttendeeIds.forEach(id => targetRooms.push(`user_${id}`));

    broadcastEmergencyAlert(
      { title: `Announcement: ${title}`, content: message, eventId: event._id },
      targetRooms
    );

    // 3. Send Batch Emails (Can be fire-and-forget or awaited)
    // We await it here to ensure success before responding, but catching errors is vital
    try {
      await sendBatchEmails(attendeeEmails, {
        subject: `Announcement: ${event.title}`,
        html: `
          <h1>New Announcement</h1>
          <p>Hi,</p>
          <p>The organizer of <strong>${event.title}</strong> has sent a new announcement:</p>
          <div style="padding: 15px; background: #f4f4f4; border-radius: 5px; border-left: 4px solid #6366f1;">
            <h3 style="margin-top: 0;">${title}</h3>
            <p style="white-space: pre-wrap;">${message}</p>
          </div>
          <p style="margin-top: 20px;">
            <a href="${process.env.FRONTEND_URL}/events/${event._id}" style="background: #6366f1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Event Details</a>
          </p>
        `,
        type: 'announcement',
        eventId: event._id
      });
    } catch (emailError) {
      console.error('Email batching failed, but notifications were sent:', emailError);
      // We don't fail the whole request if emails fail but in-app notifications worked
    }

    res.json({ 
      message: 'Announcement sent to all attendees',
      recipientCount: uniqueAttendeeIds.length
    });
  } catch (error) {
    console.error('Error in sendAnnouncement:', error);
    res.status(500).json({ message: error.message || 'Server error during announcement broadcast' });
  }
};

// @desc    Get Organizer Dashboard with analytics
// @route   GET /api/organizers/analytics
// @access  Private/Organizer
const mongoose = require('mongoose');

const getOrganizerDashboard = async (req, res) => {
  try {
    const organizerId = new mongoose.Types.ObjectId(req.user.id);

    const [events, monthlySales] = await Promise.all([
      Event.find({ organizer: organizerId }).sort('-date').lean(),

      // Monthly registration trend for this organizer's events (last 6 months)
      require('../models/Booking').aggregate([
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
          $match: {
            'eventDoc.organizer': organizerId,
            paymentStatus: 'paid',
            refundStatus: 'none'
          }
        },
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            registrations: { $sum: '$quantity' },
            revenue: { $sum: '$totalAmount' }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
        { $limit: 6 }
      ])
    ]);

    // Precise revenue calculation: sum totalAmount for paid bookings that are NOT refunded
    const revenueStats = await Booking.aggregate([
      { 
        $match: { 
          event: { $in: events.map(e => e._id) },
          paymentStatus: 'paid',
          refundStatus: 'none'
        } 
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          totalSold: { $sum: '$quantity' }
        }
      }
    ]);

    const stats = {
      totalEvents: events.length,
      totalSold: revenueStats[0]?.totalSold || 0,
      totalRevenue: revenueStats[0]?.totalRevenue || 0,
      upcomingEvents: events.filter(e => new Date(e.date) >= new Date()).length
    };

    res.json({
      stats,
      events,
      monthlySales: monthlySales.map(m => ({
        name: new Date(m._id.year, m._id.month - 1).toLocaleString('default', { month: 'short' }),
        registrations: m.registrations,
        revenue: m.revenue
      }))
    });
  } catch (error) {
    console.error('Organizer dashboard error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get paginated attendees for a specific event
// @route   GET /api/organizers/events/:id/attendees?page=&limit=
// @access  Private/Organizer
const getEventAttendees = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20, search = '' } = req.query;

    // Ensure organizer owns this event OR user is an admin
    const query = { _id: id };
    if (req.user.role !== 'admin') {
      query.organizer = req.user.id;
    }
    
    const event = await Event.findOne(query);
    if (!event) {
      return res.status(403).json({ message: 'Access denied or event not found' });
    }

    const BookingModel = require('../models/Booking');
    const skip = (Number(page) - 1) * Number(limit);

    const [bookings, total] = await Promise.all([
      BookingModel.find({ event: id, paymentStatus: 'paid', refundStatus: 'none' })
        .populate('user', 'name email createdAt')
        .sort('-createdAt')
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      BookingModel.countDocuments({ event: id, paymentStatus: 'paid', refundStatus: 'none' })
    ]);

    const attendees = bookings
      .filter(b => {
        if (!search) return true;
        const term = search.toLowerCase();
        return (
          b.user?.name?.toLowerCase().includes(term) ||
          b.user?.email?.toLowerCase().includes(term)
        );
      })
      .map(b => ({
        bookingId: b._id,
        name: b.user?.name || 'Unknown',
        email: b.user?.email || '',
        tickets: b.quantity,
        totalPaid: b.totalAmount,
        bookedAt: b.createdAt
      }));

    res.json({ attendees, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (error) {
    console.error('Attendees error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Cancel an event (Admin or Organizer-Owner)
// @route   PATCH /api/events/:id/cancel
// @access  Private (Admin/Organizer)
const cancelEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check authorization: Admin OR Organizer who owns the event
    const organizerId = event.organizer || event.createdBy;
    const isOwner = organizerId && organizerId.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized to cancel this event' });
    }

    if (event.status === 'cancelled') {
        return res.status(400).json({ message: 'Event is already cancelled' });
    }

    event.status = 'cancelled';
    await event.save();

    res.json({ message: 'Event cancelled successfully. Refunds are being processed.', event });

    // 1. Process Automatic Refunds via Stripe
    const paidBookings = await Booking.find({ event: event._id, paymentStatus: 'paid' });
    
    if (paidBookings.length > 0) {
      console.log(`💰 Initiating refunds for ${paidBookings.length} bookings...`);
      
      const refundResults = { succeeded: 0, failed: 0 };

      for (const booking of paidBookings) {
        try {
          // Find transaction to get Payment Intent ID
          const transaction = await Transaction.findOne({ 
            booking: booking._id, 
            status: 'succeeded' 
          });

          if (transaction && transaction.stripePaymentIntentId) {
            await stripe.refunds.create({
              payment_intent: transaction.stripePaymentIntentId,
              reason: 'requested_by_customer', // Event cancellation
              metadata: { eventId: event._id.toString(), bookingId: booking._id.toString() }
            });
            refundResults.succeeded++;
          } else {
            console.warn(`⚠️ No successful transaction found for booking ${booking._id}`);
            refundResults.failed++;
          }
        } catch (refundError) {
          console.error(`❌ Refund failed for booking ${booking._id}:`, refundError.message);
          refundResults.failed++;
        }
      }
      console.log(`✅ Refund process complete: ${refundResults.succeeded} successful, ${refundResults.failed} failed.`);
    }

    // 2. Notify registered attendees if there are any
    if (event.attendees && event.attendees.length > 0) {
      const attendees = await User.find({ _id: { $in: event.attendees } });
      const attendeeEmails = attendees.map(u => u.email);

      // 1. Send Batch Emails
      await sendBatchEmails(attendeeEmails, {
        subject: `Cancellation: ${event.title} has been cancelled`,
        html: `
          <h1>Event Cancelled</h1>
          <p>Hi,</p>
          <p>We regret to inform you that the event <strong>${event.title}</strong> has been cancelled.</p>
          <p>If you purchased a ticket, a refund will be processed shortly.</p>
          <a href="${process.env.FRONTEND_URL}/events/${event._id}">View Event Details</a>
        `,
        type: 'event_update',
        eventId: event._id
      });

      // 2. Send In-App Notifications
      await notifyMany(event.attendees, {
        type: 'event_update',
        title: 'Event Cancelled',
        message: `"${event.title}" has been cancelled.`,
        link: `/events/${event._id}`,
        event: event._id
      });

      // 3. Broadcast live alert to everyone in the event room, the organizer, and all attendees' personal rooms
      const targetRooms = [`event_${event._id}`, `user_${req.user.id}`];
      event.attendees.forEach(id => targetRooms.push(`user_${id}`));

      broadcastEmergencyAlert(
        { 
          title: 'Event Cancelled', 
          content: `The event "${event.title}" has been cancelled by the organizer.`, 
          eventId: event._id 
        },
        targetRooms
      );
    }
  } catch (error) {
    console.error('Error in cancelEvent:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createEvent,
  getAllEvents,
  getMyEvents,
  getPublicEvents,
  updateEvent,
  deleteEvent,
  registerForEvent,
  getEventById,
  getCategories,
  sendAnnouncement,
  getOrganizerDashboard,
  getEventAttendees,
  cancelEvent,
};
