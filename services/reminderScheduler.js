const cron = require('node-cron');
const Event = require('../models/Event');
const Booking = require('../models/Booking');
const { sendEmail } = require('./emailService');
const { createNotification } = require('./notificationService');

// State lock to prevent concurrent executions of the cron job
let isRunning = false;

// Run every hour
const startReminderCron = () => {
  cron.schedule('0 * * * *', async () => {
    if (isRunning) {
      console.log('[NODE-CRON] Previous reminder job is still running. Skipping execution.');
      return;
    }

    console.log(`[NODE-CRON] Starting reminder check at ${new Date().toISOString()}...`);
    isRunning = true;
    const startTime = Date.now();

    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const dayAfter = new Date(tomorrow);
      dayAfter.setHours(dayAfter.getHours() + 1);

      // Find events starting in the next 24-25 hours
      const upcomingEvents = await Event.find({
        date: {
          $gte: tomorrow,
          $lt: dayAfter
        }
      });

      console.log(`[NODE-CRON] Found ${upcomingEvents.length} upcoming events to process.`);

      for (const event of upcomingEvents) {
        // Find all users who booked this event
        const bookings = await Booking.find({ 
          event: event._id,
          paymentStatus: 'paid' 
        }).populate('user');

        console.log(`[NODE-CRON] Processing ${bookings.length} paid bookings for event: "${event.title}"`);

        // Use Promise.allSettled to send notifications asynchronously without blocking the event loop
        // sequentially, ensuring one failed email doesn't stop others.
        await Promise.allSettled(bookings.map(async (booking) => {
          const user = booking.user;
          if (!user) return;

          // Send Email Reminder
          const emailTask = sendEmail({
            to: user.email,
            subject: `Reminder: ${event.title} is Tomorrow!`,
            html: `
              <h1>Event Reminder</h1>
              <p>Hi ${user.name},</p>
              <p>This is a friendly reminder that the event <strong>${event.title}</strong> is happening tomorrow!</p>
              <p>Location: ${event.location}</p>
              <p>Time: ${new Date(event.date).toLocaleString()}</p>
            `,
            type: 'reminder',
            eventId: event._id,
            idempotencyKey: `reminder-email-${event._id}-${user._id}`
          });

          // Send In-App Notification
          const notificationTask = createNotification({
            recipient: user._id,
            type: 'reminder',
            title: 'Event Reminder',
            message: `"${event.title}" is happening tomorrow!`,
            event: event._id,
            idempotencyKey: `reminder-app-${event._id}-${user._id}`
          });

          // Wait for both to complete for this user
          await Promise.all([emailTask, notificationTask]);
        }));
      }
    } catch (error) {
      console.error('[NODE-CRON] Error in reminder cron job:', error);
    } finally {
      // Ensure the lock is released and log duration
      isRunning = false;
      const duration = Date.now() - startTime;
      console.log(`[NODE-CRON] Finished reminder check in ${duration}ms.`);
    }
  }, {
    scheduled: true,
    timezone: "UTC"
  });
};

module.exports = { startReminderCron };
