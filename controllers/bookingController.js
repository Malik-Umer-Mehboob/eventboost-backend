const Booking = require('../models/Booking');
const Event = require('../models/Event');
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? require('stripe')(stripeSecretKey) : null;
const qrcode = require('qrcode');
const Ticket = require('../models/Ticket');
const Transaction = require('../models/Transaction');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const { createNotification } = require('../services/notificationService');
const { broadcastAttendeeCount, broadcastEventUpdate } = require('../config/socket');
const { notifyNextInWaitlist } = require('../utils/waitlistNotifier');

const initiateBooking = async (req, res) => {
  try {
    const { quantity } = req.body;
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    
    // Authorization Check
    if (req.user.role === 'admin') {
      return res.status(400).json({ message: 'Admins cannot purchase tickets' });
    }
    
    if (event.organizer.toString() === req.user.id.toString()) {
      return res.status(400).json({ message: 'Organizers cannot purchase tickets for their own events' });
    }

    const notifiedEntry = await require('../models/Waitlist').findOne({ 
      event: event._id, 
      user: req.user.id, 
      status: 'notified' 
    });

    const availableTickets = event.ticketQuantity - event.soldTickets;

    if (availableTickets < quantity) {
      return res.status(400).json({ message: 'Not enough tickets available' });
    }

    // If user is not notified but tickets are reserved for waitlist
    if (!notifiedEntry) {
      const notifiedCount = await require('../models/Waitlist').countDocuments({ 
        event: event._id, 
        status: 'notified' 
      });
      if (availableTickets - notifiedCount < quantity) {
        return res.status(400).json({ 
          message: 'The remaining tickets are reserved for waitlist users. Please join the waitlist to be notified when more spots open up.' 
        });
      }
    }
    const booking = await Booking.create({ 
      user: req.user.id, 
      event: event._id, 
      quantity, 
      totalAmount: event.ticketPrice * quantity, 
      paymentStatus: 'pending' 
    });

    if (!stripe) {
      return res.status(500).json({ message: 'Stripe is not configured on this server' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: event.title, description: event.description },
          unit_amount: event.ticketPrice * 100,
        },
        quantity,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/events/${event._id}?canceled=true`,
      customer_email: req.user.email,
      metadata: { 
        bookingId: booking._id.toString(),
        eventId: event._id.toString(), 
        userId: req.user.id.toString(), 
        quantity: quantity.toString() 
      },
    });

    // Update booking with stripeSessionId
    booking.stripeSessionId = session.id;
    await booking.save();

    res.json({ id: session.id, url: session.url });
  } catch (error) {
    console.error('Error initiating booking:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const stripeWebhook = async (req, res) => {
  // ✅ DB connect karo pehle
  await require('../config/db')();

  const sig = req.headers['stripe-signature'];
  let stripeEvent;

  console.log('----------------------------------------------------');
  console.log('🔔 STRIPE WEBHOOK: Incoming Request Received');
  console.log('📅 Timestamp:', new Date().toISOString());
  console.log('📡 Headers - Stripe-Signature exists:', !!sig);

  // 1. Check for missing signature
  if (!sig) {
    console.error('❌ FATAL: Missing stripe-signature header. Is the webhook coming from Stripe?');
    return res.status(400).send('Webhook Error: Missing stripe-signature header');
  }

  // 2. Check for express.json() interference (req.body should be a Buffer)
  if (!Buffer.isBuffer(req.body)) {
    console.error('❌ FATAL: req.body is not a Buffer! express.json() or other body-parser likely interfered.');
    console.log('   Current body type:', typeof req.body);
    return res.status(400).send('Webhook Error: Request body is not raw (middleware ordering issue)');
  }

  // 3. Signature Verification
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('❌ FATAL: STRIPE_WEBHOOK_SECRET is missing in .env');
      throw new Error('STRIPE_WEBHOOK_SECRET not configured');
    }

    if (!stripe) {
      console.error('❌ FATAL: Stripe is not configured');
      throw new Error('Stripe is not configured');
    }

    stripeEvent = stripe.webhooks.constructEvent(req.body, sig, webhookSecret, 300);
    console.log('✅ SIGNATURE VERIFIED: Event ID:', stripeEvent.id);
    console.log('💡 EVENT TYPE:', stripeEvent.type);
  } catch (err) {
    console.error(`❌ SIGNATURE VERIFICATION FAILED: ${err.message}`);
    console.log('   Check if STRIPE_WEBHOOK_SECRET in .env matches your Stripe CLI or Dashboard secret.');
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 4. Handle "checkout.session.completed"
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    console.log('📦 PROCESSING SESSION:', session.id);

    const { bookingId, eventId, userId, quantity: quantityStr } = session.metadata || {};
    console.log('📝 METADATA RECEIVED:', session.metadata);

    if (!bookingId || !eventId || !userId || !quantityStr) {
      console.error('❌ CRITICAL: Missing required metadata in Stripe session!');
      return res.status(200).json({ received: true, error: 'Missing metadata' });
    }

    const quantity = parseInt(quantityStr, 10);
    if (isNaN(quantity)) {
      console.error('❌ CRITICAL: Quantity parsing failed! Value:', quantityStr);
      return res.status(200).json({ received: true, error: 'Invalid quantity' });
    }
    console.log(`📝 PARSED: Quantity(${quantity})`);

    try {
      const existingTransaction = await Transaction.findOne({ stripeSessionId: session.id });
      if (existingTransaction) {
        console.log(`ℹ️ IDEMPOTENCY: Session ${session.id} already processed. Skipping.`);
        return res.status(200).json({ received: true });
      }

      console.log(`🔍 LOOKUP: Finding Booking ${bookingId}...`);
      let booking = await Booking.findById(bookingId);
      
      if (!booking) {
        console.log(`⚠️ FALLBACK: Searching by stripeSessionId ${session.id}...`);
        booking = await Booking.findOne({ stripeSessionId: session.id });
      }

      if (!booking) {
        console.error('❌ CRITICAL ERROR: Booking NOT FOUND in MongoDB.');
        throw new Error(`Booking ${bookingId} not found`);
      }
      console.log('✅ BOOKING FOUND:', booking._id);

      console.log('🔄 STARTING DATABASE UPDATES...');

      if (booking.paymentStatus === 'paid') {
        console.log(`ℹ️ SKIP: Booking ${booking._id} already paid.`);
      } else {
        booking.paymentStatus = 'paid';
        booking.stripeSessionId = session.id;
        booking.qrCode = await qrcode.toDataURL(JSON.stringify({ 
          bookingId: booking._id, 
          eventId, 
          userId,
          quantity
        }));
        await booking.save();
        console.log('✅ STEP 1/5: Booking status set to paid');
      }

      await Transaction.create({
        user: userId,
        booking: booking._id,
        event: eventId,
        amount: session.amount_total / 100,
        status: 'succeeded',
        type: 'payment',
        stripePaymentIntentId: session.payment_intent,
        stripeSessionId: session.id,
        paymentMethod: session.payment_method_types[0],
        metadata: session.metadata
      });
      console.log('✅ STEP 2/5: Transaction created');

      const event = await Event.findByIdAndUpdate(
        eventId, 
        { 
          $inc: { soldTickets: quantity },
          $addToSet: { attendees: userId }
        }, 
        { returnDocument: 'after' }
      );

      if (!event) throw new Error(`Event ${eventId} not found`);
      console.log(`✅ STEP 3/5: Event capacity updated. Sold: ${event.soldTickets}/${event.ticketQuantity}`);
      
      broadcastAttendeeCount(eventId, event.soldTickets);

      const tickets = [];
      for (let i = 0; i < quantity; i++) {
        const ticketNumber = `TKT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const ticket = await Ticket.create({
          user: userId,
          event: eventId,
          paymentId: session.id,
          amount: (session.amount_total / 100) / quantity,
          ticketNumber,
          qrCode: await qrcode.toDataURL(ticketNumber),
          isValid: true,
          paymentIntentId: session.payment_intent
        });
        tickets.push(ticket);
      }
      console.log(`✅ STEP 4/5: ${tickets.length} ticket(s) created`);

      const populatedBooking = await Booking.findById(booking._id).populate('user event');
      if (populatedBooking && populatedBooking.user) {
        await sendTicketEmail(populatedBooking.user, populatedBooking.event, tickets);
        console.log('   Email sent to:', populatedBooking.user.email);
      }

      await createNotification({
        recipient: userId,
        type: 'ticket_confirmation',
        title: 'Payment Successful! 🎟',
        message: `You've successfully purchased ${quantity} ticket(s) for "${event.title}".`,
        link: `/tickets/my-tickets`,
        event: eventId
      });

      await require('../models/Waitlist').findOneAndUpdate(
        { event: eventId, user: userId, status: 'notified' },
        { status: 'converted' }
      );
      
      console.log('✅ STEP 5/5: Notifications sent');
      console.log('🎉 SUCCESS: Webhook processing complete!');
      console.log('----------------------------------------------------');
      return res.status(200).json({ received: true });

    } catch (dbError) {
      console.error('❌ MONGODB ERROR:', dbError.stack);
      return res.status(500).json({ error: 'Database update failed', message: dbError.message });
    }
  } 
  
  if (stripeEvent.type === 'charge.refunded' || stripeEvent.type === 'payment_intent.amount_refunded') {
    const object = stripeEvent.data.object;
    const paymentIntentId = object.payment_intent || object.id;
    console.log(`🔄 REFUND: Processing for PI:`, paymentIntentId);
    
    try {
      await processRefundRollback(paymentIntentId);
      console.log('✅ Refund rollback completed');
    } catch (refError) {
      console.error('❌ REFUND ERROR:', refError.message);
    }
  }

  res.status(200).json({ received: true });
};

// Helper to rollback state on refund
const processRefundRollback = async (paymentIntentId) => {
  // 1. Find and update Transaction (idempotency check)
  const transaction = await Transaction.findOne({ stripePaymentIntentId: paymentIntentId }).populate('user');
  
  if (!transaction) {
    console.warn(`No transaction found for PI: ${paymentIntentId} during rollback`);
    return;
  }

  if (transaction.status === 'refunded') {
    console.log(`ℹ️ IDEMPOTENCY: Transaction ${paymentIntentId} already marked as refunded.`);
    return;
  }

  // Mark transaction as refunded
  transaction.status = 'refunded';
  await transaction.save();

  // 2. Update Booking
  const booking = await Booking.findByIdAndUpdate(transaction.booking, { 
    refundStatus: 'completed',
    paymentStatus: 'refunded' 
  }, { returnDocument: 'after' });

  if (!booking) {
      console.error(`❌ CRITICAL: Booking not found for transaction ${transaction._id}`);
  }

  // 3. Invalidate Tickets
  await Ticket.updateMany(
    { paymentIntentId: paymentIntentId },
    { isValid: false, refundStatus: 'refunded' }
  );

  // 4. Rollback Event Capacity (Atomic update)
  if (booking) {
    const event = await Event.findByIdAndUpdate(
      transaction.event,
      { $inc: { soldTickets: -booking.quantity } },
      { returnDocument: 'after' }
    );
    if (event) {
        console.log(`✅ EVENT CAPACITY RESTORED: ${event.title}`);
        console.log(`   Previous sold: ${event.soldTickets + booking.quantity} -> New sold: ${event.soldTickets}`);
        console.log(`   Available: ${event.ticketQuantity - event.soldTickets}`);
        
        // Broadcast live updates
        broadcastAttendeeCount(event._id, event.soldTickets);
        broadcastEventUpdate(event.toObject(), 'updated');
        
        // 5. Notifications
        await createNotification({
            recipient: transaction.user._id,
            type: 'event_update',
            title: 'Refund Processed 💰',
            message: `Your refund for "${event.title}" has been processed successfully. ${booking.quantity} seats have been released.`,
            event: transaction.event._id
        });

        // 6. Send Email
        await sendRefundConfirmationEmail(transaction.user, event, booking);

        // 7. Waitlist: Notify next person in line
        await notifyNextInWaitlist(event._id);
    }
  }
};

const sendRefundConfirmationEmail = async (user, event, booking) => {
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
            subject: 'Refund Confirmation - EventBoost Pro',
            text: `Hi ${user.name},\n\nYour refund for "${event.title}" has been processed successfully. The amount of $${booking.totalAmount} has been returned to your original payment method.\n\nEvent: ${event.title}\nQuantity: ${booking.quantity}\n\nWe hope to see you at another event soon!\n\nBest regards,\nEventBoost Pro Team`
        });
    } catch (error) {
        console.error('Error sending refund email:', error);
    }
};

const sendTicketEmail = async (user, event, tickets) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const doc = new PDFDocument();
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    
    return new Promise((resolve, reject) => {
      doc.on('end', async () => {
        const pdfData = Buffer.concat(buffers);
        
        try {
          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: 'Your Ticket Confirmation 🎟 - EventBoost Pro',
            text: `Hi ${user.name},\n\nThank you for your purchase! Attached is your ticket for ${event.title}.\n\nEvent Details:\nDate: ${new Date(event.date).toLocaleString()}\nLocation: ${event.location}\n\nWe look forward to seeing you there!`,
            attachments: [
              {
                filename: `tickets-${event.title.replace(/\s+/g, '-').toLowerCase()}.pdf`,
                content: pdfData,
              },
            ],
          });
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      // PDF Content
      doc.fontSize(24).text('EVENT TICKETS', { align: 'center' });
      doc.moveDown();
      doc.fontSize(18).text(event.title, { align: 'center' });
      doc.fontSize(12).text(`${new Date(event.date).toLocaleString()} | ${event.location}`, { align: 'center' });
      doc.moveDown();
      doc.text('--------------------------------------------------', { align: 'center' });
      doc.moveDown();

      tickets.forEach((ticket, index) => {
        if (index > 0) doc.addPage();
        doc.fontSize(24).text('EVENT TICKET', { align: 'center' });
        doc.moveDown();
        doc.fontSize(18).text(event.title, { align: 'center' });
        doc.fontSize(12).text(`${new Date(event.date).toLocaleString()} | ${event.location}`, { align: 'center' });
        doc.moveDown();
        doc.text('--------------------------------------------------', { align: 'center' });
        doc.moveDown();
        
        doc.fontSize(16).text(`Ticket ${index + 1} of ${tickets.length}`, { align: 'center' });
        doc.fontSize(12).text(`Ticket Number: ${ticket.ticketNumber}`, { align: 'center' });
        doc.moveDown();
        doc.text(`Attendee: ${user.name}`, { align: 'center' });
        doc.moveDown();
        
        if (ticket.qrCode) {
            const base64Data = ticket.qrCode.split(',')[1];
            if (base64Data) {
                doc.image(Buffer.from(base64Data, 'base64'), {
                    fit: [150, 150],
                    align: 'center'
                });
            }
        }
        
        doc.moveDown();
        doc.text('Present this ticket at the entrance.', { align: 'center' });
      });

      doc.end();
    });
  } catch (error) {
    console.error('Error sending ticket email:', error);
  }
};

const getMyBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.user.id }).populate('event').sort('-createdAt');
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

const downloadBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('event user');
    
    if (!booking) {
      return res.status(404).json({ message: 'Booking record not found' });
    }

    // Check ownership
    if (booking.user._id.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized: You do not own this booking' });
    }

    // Check payment status
    if (booking.paymentStatus !== 'paid') {
      return res.status(400).json({ 
        message: `Payment is ${booking.paymentStatus}. Tickets are only available after successful payment.` 
      });
    }

    // Fetch all tickets associated with this booking via Stripe Session ID
    // This is the most reliable link between a Booking and its Tickets
    const tickets = await Ticket.find({ 
      paymentId: booking.stripeSessionId
    }).populate('event user');

    if (tickets.length === 0) {
      console.error(`Tickets missing for booking ${booking._id} (Session: ${booking.stripeSessionId})`);
      return res.status(404).json({ 
        message: 'Ticket records not found for this booking. Please contact support if you were charged.' 
      });
    }

    const doc = new PDFDocument();
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=tickets-${booking.event.title.replace(/\s+/g, '-').toLowerCase()}.pdf`);
    
    doc.pipe(res);

    // PDF Global Header
    doc.fontSize(24).text('EVENT TICKETS', { align: 'center' });
    doc.moveDown();
    doc.fontSize(18).text(booking.event.title, { align: 'center' });
    doc.fontSize(12).text(`${new Date(booking.event.date).toLocaleString()} | ${booking.event.location}`, { align: 'center' });
    doc.moveDown();
    doc.text('--------------------------------------------------', { align: 'center' });
    doc.moveDown();

    tickets.forEach((ticket, index) => {
      if (index > 0) doc.addPage();
      
      doc.fontSize(24).text('EVENT TICKET', { align: 'center' });
      doc.moveDown();
      doc.fontSize(18).text(booking.event.title, { align: 'center' });
      doc.fontSize(12).text(`${new Date(booking.event.date).toLocaleString()} | ${booking.event.location}`, { align: 'center' });
      doc.moveDown();
      doc.text('--------------------------------------------------', { align: 'center' });
      doc.moveDown();
      
      doc.fontSize(16).text(`Ticket ${index + 1} of ${tickets.length}`, { align: 'center' });
      doc.fontSize(12).text(`Ticket Number: ${ticket.ticketNumber}`, { align: 'center' });
      doc.moveDown();
      doc.text(`Attendee: ${booking.user.name}`, { align: 'center' });
      doc.moveDown();
      
      if (ticket.qrCode) {
        const base64Data = ticket.qrCode.split(',')[1];
        if (base64Data) {
          doc.image(Buffer.from(base64Data, 'base64'), {
            fit: [150, 150],
            align: 'center'
          });
        }
      }
      
      doc.moveDown();
      doc.text('Present this ticket at the entrance.', { align: 'center' });
    });

    doc.end();
  } catch (error) {
    console.error('Error in downloadBooking:', error);
    res.status(500).json({ message: 'Server error during PDF generation' });
  }
};

const getMyTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({ user: req.user.id })
      .populate('event', 'title date location')
      .sort('-createdAt');
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

const refundBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    // Authorization: User can request refund for own booking, admin can always
    if (booking.user.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (booking.paymentStatus !== 'paid') {
      return res.status(400).json({ message: 'Only paid bookings can be refunded' });
    }

    if (booking.refundStatus === 'requested' || booking.refundStatus === 'completed') {
      return res.status(400).json({ message: 'Refund already requested or completed' });
    }

    // Find the associated transaction to get the payment intent
    const transaction = await Transaction.findOne({ booking: booking._id, status: 'succeeded' });

    if (!transaction || !transaction.stripePaymentIntentId) {
      return res.status(400).json({ message: 'Stripe transaction not found' });
    }

    if (!stripe) {
      return res.status(500).json({ message: 'Stripe is not configured on this server' });
    }

    // Communicate with Stripe to process refund
    const refund = await stripe.refunds.create({
      payment_intent: transaction.stripePaymentIntentId,
    });

    // Update booking status
    booking.refundStatus = 'requested';
    await booking.save();

    res.json({ message: 'Refund request initiated', refundId: refund.id });
  } catch (error) {
    console.error('Refund error:', error);
    res.status(500).json({ message: error.message || 'Server error during refund' });
  }
};

// @desc    Get User Dashboard — upcoming/past split with spend summary
// @route   GET /api/bookings/my-dashboard
// @access  Private
const getMyDashboard = async (req, res) => {
  try {
    const now = new Date();
    const bookings = await Booking.find({ 
      user: req.user.id, 
      paymentStatus: { $in: ['paid', 'refunded'] } 
    })
      .populate('event', 'title date location bannerImage ticketPrice category')
      .sort('-createdAt')
      .lean();

    const upcoming = bookings.filter(b => b.event && new Date(b.event.date) >= now && b.paymentStatus === 'paid');
    const past = bookings.filter(b => b.event && new Date(b.event.date) < now && b.paymentStatus === 'paid');
    const totalSpend = bookings.reduce((acc, b) => {
        return acc + (b.paymentStatus === 'paid' ? (b.totalAmount || 0) : 0);
    }, 0);

    res.json({ 
      upcoming, 
      past, 
      totalSpend, 
      totalBookings: bookings.filter(b => b.paymentStatus === 'paid').length 
    });
  } catch (error) {
    console.error('User dashboard error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { initiateBooking, stripeWebhook, getMyBookings, downloadBooking, getMyTransactions, refundBooking, getMyDashboard };
