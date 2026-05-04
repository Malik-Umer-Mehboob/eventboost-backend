const Waitlist = require('../models/Waitlist');
const { sendEmail } = require('../services/emailService');
const { createNotification } = require('../services/notificationService');

const notifyNextInWaitlist = async (eventId) => {
  try {
    const next = await Waitlist.findOne({ 
      event: eventId, 
      status: 'waiting' 
    }).sort({ position: 1 }).populate('user event');
    
    if (!next) return;
    
    const expiryHours = 24;
    next.status = 'notified';
    next.notifiedAt = new Date();
    next.expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
    await next.save();
    
    // Send email to user
    await sendEmail({
      to: next.user.email,
      subject: `A spot opened up for ${next.event.title}! 🎟`,
      type: 'waitlist_notification',
      eventId: next.event._id,
      html: `
        <div style="font-family: sans-serif; color: #1a2b3d; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #162333; padding: 30px; text-align: center;">
            <h1 style="color: #c9a84c; margin: 0;">Great News!</h1>
          </div>
          <div style="padding: 30px; line-height: 1.6;">
            <p>Hi ${next.user.name},</p>
            <p>A spot has just opened up for <strong>${next.event.title}</strong>! Since you were next on the waitlist, we've reserved it for you.</p>
            
            <div style="background: rgba(29, 158, 117, 0.05); border: 1px solid #1d9e75; border-radius: 8px; padding: 20px; margin: 25px 0; text-align: center;">
              <h3 style="color: #1d9e75; margin-top: 0;">Time Sensitive Invitation</h3>
              <p style="margin-bottom: 20px;">You have <strong>${expiryHours} hours</strong> to complete your purchase before this spot is offered to the next person in line.</p>
              <a href="${process.env.FRONTEND_URL}/events/${next.event._id}" 
                 style="background: #c9a84c; color: #162333; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Buy Ticket Now
              </a>
            </div>

            <p style="font-size: 14px; color: #7a94aa;">
              <strong>Event Details:</strong><br>
              Date: ${new Date(next.event.date).toLocaleDateString()}<br>
              Venue: ${next.event.location}
            </p>
          </div>
          <div style="background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #7a94aa;">
            &copy; ${new Date().getFullYear()} EventBoost Pro. All rights reserved.
          </div>
        </div>
      `
    });

    // In-app notification
    await createNotification({
      recipient: next.user._id,
      type: 'event_update',
      title: 'Spot Available! 🎟',
      message: `A spot opened up for "${next.event.title}". You have 24 hours to purchase your ticket.`,
      link: `/events/${next.event._id}`,
      event: next.event._id
    });

    console.log(`📣 Notified next user ${next.user.email} on waitlist for event ${eventId}`);
  } catch (error) {
    console.error('Error in notifyNextInWaitlist:', error);
  }
};

module.exports = { notifyNextInWaitlist };
