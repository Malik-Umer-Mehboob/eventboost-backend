const Waitlist = require('../models/Waitlist');
const { notifyNextInWaitlist } = require('../utils/waitlistNotifier');
const { sendEmail } = require('../services/emailService');

const checkExpiredWaitlistSpots = async () => {
  try {
    const now = new Date();
    // Find all entries that have expired
    const expiredEntries = await Waitlist.find({
      status: 'notified',
      expiresAt: { $lt: now }
    }).populate('user event');

    if (expiredEntries.length === 0) return;

    console.log(`🕒 Cron: Found ${expiredEntries.length} expired waitlist spots.`);

    for (const entry of expiredEntries) {
      entry.status = 'expired';
      await entry.save();

      // Notify the user that their spot has expired
      await sendEmail({
        to: entry.user.email,
        subject: `Your waitlist spot for ${entry.event.title} has expired ❌`,
        type: 'waitlist_expired',
        eventId: entry.event._id,
        html: `
          <div style="font-family: sans-serif; color: #1a2b3d; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background-color: #162333; padding: 30px; text-align: center;">
              <h1 style="color: #e24b4a; margin: 0;">Spot Expired</h1>
            </div>
            <div style="padding: 30px; line-height: 1.6;">
              <p>Hi ${entry.user.name},</p>
              <p>Your 24-hour window to purchase a ticket for <strong>${entry.event.title}</strong> has expired.</p>
              <p>Unfortunately, your spot has been offered to the next person in line. You can join the waitlist again if you'd like to wait for another opening.</p>
            </div>
            <div style="background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #7a94aa;">
              &copy; ${new Date().getFullYear()} EventBoost Pro. All rights reserved.
            </div>
          </div>
        `
      });

      // Notify the next person in line
      await notifyNextInWaitlist(entry.event._id);
    }
  } catch (error) {
    console.error('Error in checkExpiredWaitlistSpots:', error);
  }
};

const startWaitlistCron = () => {
  console.log('🕒 Waitlist Cron started (Hourly check)');
  // Run every hour
  setInterval(checkExpiredWaitlistSpots, 60 * 60 * 1000);
  
  // Also run once on startup after a small delay
  setTimeout(checkExpiredWaitlistSpots, 10000);
};

module.exports = { startWaitlistCron };
