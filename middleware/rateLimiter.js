const rateLimit = require('express-rate-limit');

/**
 * Strict rate limiter for announcements to prevent spam
 */
const announcementLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit each organizer to 5 announcements per hour
  message: {
    message: 'Too many announcements sent. Please try again after an hour.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * General rate limiter for notification operations
 */
const notificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  announcementLimiter,
  notificationLimiter
};
