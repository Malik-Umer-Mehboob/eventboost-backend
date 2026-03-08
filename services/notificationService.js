const Notification = require('../models/Notification');
const { sendSocketNotification } = require('../config/socket');

/**
 * Create a notification and send it via WebSockets
 * @param {Object} data - { recipient, sender, type, title, message, link, event }
 */
const createNotification = async (data) => {
  try {
    if (!data || !data.recipient) {
      console.warn('❌ [NotificationService] Failed to create notification: missing recipient field', data);
      return null;
    }

    const { idempotencyKey } = data;
    
    // Check if notification with this idempotency key already exists
    if (idempotencyKey) {
      const existing = await Notification.findOne({ idempotencyKey });
      if (existing) return existing;
    }

    const notification = await Notification.create(data);
    
    // Send real-time update
    sendSocketNotification(data.recipient, notification);
    
    return notification;
  } catch (error) {
    if (error.code === 11000) { // Duplicate key error
      return Notification.findOne({ idempotencyKey: data.idempotencyKey });
    }
    console.error('Error creating notification:', error);
    return null;
  }
};

/**
 * Send notification to multiple recipients
 * @param {Array} recipientIds
 * @param {Object} data - { sender, type, title, message, link, event }
 */
const notifyMany = async (recipientIds, data) => {
  try {
    if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
      console.warn('❌ [NotificationService] notifyMany called with empty or invalid recipientIds', recipientIds);
      return [];
    }

    const { idempotencyKeyBase, ...rest } = data;
    
    // Filter out null or missing IDs and convert to simple array of objects for insertMany
    const validRecipients = recipientIds.filter(id => id != null);
    if (validRecipients.length === 0) return [];

    const notifications = validRecipients.map((id, index) => {
      const recipientId = id.toString();
      return {
        ...rest,
        recipient: recipientId,
        idempotencyKey: idempotencyKeyBase ? `${idempotencyKeyBase}-${recipientId}` : undefined
      };
    });
    
    // insertMany is atomic per document, ordered: false allows partial success if some are duplicates
    const savedNotifications = await Notification.insertMany(notifications, { ordered: false });
    
    // Send socket updates to each (Safe check and batching)
    if (savedNotifications && Array.isArray(savedNotifications)) {
      console.log(`📡 Sending ${savedNotifications.length} socket notifications...`);
      savedNotifications.forEach(n => {
        sendSocketNotification(n.recipient, n);
      });
    }
    
    return savedNotifications;
  } catch (error) {
    // 11000 is duplicate key error (idempotency triggered)
    if (error.code === 11000) {
      console.log('ℹ️ Some notifications were already sent (idempotency)');
      // Return what we can or just success
      return Notification.find({ 
        recipient: { $in: recipientIds }, 
        type: data.type,
        event: data.event
      }).lean();
    }
    console.error('Error sending batch notifications:', error);
    throw error; // Rethrow to let the controller handle it
  }
};

module.exports = {
  createNotification,
  notifyMany
};
