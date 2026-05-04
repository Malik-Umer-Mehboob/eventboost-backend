const Waitlist = require('../models/Waitlist');
const Event = require('../models/Event');
const { sendEmail } = require('../services/emailService');

// @desc    Join waitlist for an event
// @route   POST /api/waitlist/join/:eventId
// @access  Private
const joinWaitlist = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    // Check if event is actually sold out
    const isSoldOut = event.soldTickets >= event.ticketQuantity;
    if (!isSoldOut) {
      return res.status(400).json({ message: 'Tickets are still available. You can purchase directly.' });
    }

    // Check if user already has a ticket
    if (event.attendees.includes(req.user.id)) {
      return res.status(400).json({ message: 'You already have a ticket for this event.' });
    }

    // Check if user already on waitlist
    const existing = await Waitlist.findOne({ event: event._id, user: req.user.id });
    if (existing) {
      return res.status(400).json({ message: 'You are already on the waitlist for this event.' });
    }

    // Get current waitlist count for position
    const count = await Waitlist.countDocuments({ event: event._id, status: { $in: ['waiting', 'notified'] } });
    
    const waitlistEntry = await Waitlist.create({
      event: event._id,
      user: req.user.id,
      position: count + 1,
      status: 'waiting'
    });

    // Send confirmation email
    await sendEmail({
      to: req.user.email,
      subject: `You're on the waitlist for ${event.title}! ⏳`,
      type: 'waitlist_confirmation',
      eventId: event._id,
      html: `
        <div style="font-family: sans-serif; color: #1a2b3d; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #162333; padding: 30px; text-align: center;">
            <h1 style="color: #c9a84c; margin: 0;">Waitlist Joined</h1>
          </div>
          <div style="padding: 30px; line-height: 1.6;">
            <p>Hi ${req.user.name},</p>
            <p>You've successfully joined the waitlist for <strong>${event.title}</strong>.</p>
            
            <div style="background: rgba(201, 168, 76, 0.05); border: 1px solid #c9a84c; border-radius: 8px; padding: 20px; margin: 25px 0; text-align: center;">
              <p style="margin: 0; font-size: 14px; color: #7a94aa;">Your Current Position</p>
              <h2 style="color: #c9a84c; margin: 5px 0;">#${waitlistEntry.position}</h2>
            </div>

            <p>We'll notify you immediately via email and app notification if a spot opens up. You'll have 24 hours to purchase your ticket once notified.</p>
          </div>
          <div style="background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #7a94aa;">
            &copy; ${new Date().getFullYear()} EventBoost Pro. All rights reserved.
          </div>
        </div>
      `
    });

    res.status(201).json({ position: waitlistEntry.position, status: waitlistEntry.status });
  } catch (error) {
    console.error('Join waitlist error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Leave waitlist
// @route   DELETE /api/waitlist/leave/:eventId
// @access  Private
const leaveWaitlist = async (req, res) => {
  try {
    const entry = await Waitlist.findOne({ event: req.params.eventId, user: req.user.id });
    if (!entry) return res.status(404).json({ message: 'Waitlist entry not found' });

    const removedPosition = entry.position;
    await entry.deleteOne();

    // Reorder subsequent positions
    await Waitlist.updateMany(
      { event: req.params.eventId, position: { $gt: removedPosition }, status: 'waiting' },
      { $inc: { position: -1 } }
    );

    res.json({ message: 'Removed from waitlist' });
  } catch (error) {
    console.error('Leave waitlist error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get user's position on waitlist
// @route   GET /api/waitlist/position/:eventId
// @access  Private
const getUserPosition = async (req, res) => {
  try {
    const entry = await Waitlist.findOne({ event: req.params.eventId, user: req.user.id });
    if (!entry) return res.json({ position: null, status: null });

    res.json({ 
      position: entry.position, 
      status: entry.status,
      expiresAt: entry.expiresAt 
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get full waitlist for an event (Admin/Organizer)
// @route   GET /api/waitlist/:eventId
// @access  Private (Admin/Organizer)
const getEventWaitlist = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    // Auth check
    const isOwner = event.organizer.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const waitlist = await Waitlist.find({ event: event._id })
      .populate('user', 'name email')
      .sort({ position: 1 });
      
    res.json(waitlist);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get current user's waitlist entries
// @route   GET /api/waitlist/my-waitlist
// @access  Private
const getMyWaitlist = async (req, res) => {
  try {
    const waitlist = await Waitlist.find({ user: req.user.id })
      .populate('event', 'title date location bannerImage ticketPrice')
      .sort({ createdAt: -1 });
    res.json(waitlist);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { joinWaitlist, leaveWaitlist, getUserPosition, getEventWaitlist, getMyWaitlist };
