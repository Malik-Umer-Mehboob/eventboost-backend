const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      methods: ['GET', 'POST']
    }
  });

  // Socket middleware for JWT verification
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error: Token missing'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      socket.user = user;
      next();
    } catch (err) {
      console.error('Socket Auth Error:', err.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id} (${socket.user.name})`);

    // Automatically join personal room
    socket.join(`user_${socket.user._id}`);
    
    // Automatically join role-based room
    socket.join(`role_${socket.user.role}`);

    // Manual room management
    socket.on('join_event', (eventId) => {
      socket.join(`event_${eventId}`);
      console.log(`User ${socket.user.name} joined event room: event_${eventId}`);
    });

    socket.on('leave_event', (eventId) => {
      socket.leave(`event_${eventId}`);
      console.log(`User ${socket.user.name} left event room: event_${eventId}`);
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

/**
 * Send notification to a specific user via Socket.IO
 * @param {string} userId - Recipient User ID
 * @param {Object} notification - Notification object
 */
const sendSocketNotification = (userId, notification) => {
  if (io) {
    io.to(`user_${userId}`).emit('new_notification', notification);
  }
};

/**
 * Broadcast an event update to ALL connected clients.
 * @param {Object} event - The event object
 * @param {string} action - 'created' | 'updated' | 'deleted'
 */
const broadcastEventUpdate = (event, action = 'updated') => {
  if (io) io.emit('event:updated', { event, action });
};

/**
 * Broadcast live attendee count to everyone inside the event room.
 * @param {string} eventId
 * @param {number} soldTickets
 */
const broadcastAttendeeCount = (eventId, soldTickets) => {
  if (io) io.to(`event_${eventId}`).emit('event:attendee_count', { eventId, soldTickets });
};

/**
 * Broadcast an emergency/announcement alert.
 * @param {Object} payload - { title, content, eventId? }
 * @param {string[]} targetRooms - Optional room names. Empty = platform-wide.
 */
const broadcastEmergencyAlert = (payload, targetRooms = []) => {
  if (!io) {
    console.error('❌ Socket.io NOT initialized in broadcastEmergencyAlert');
    return;
  }
  
  console.log(`📣 Broadcasting Emergency Alert: "${payload.title}" to ${targetRooms.length === 0 ? 'ALL' : targetRooms.join(', ')}`);
  
  // Standardize payload for frontend: { title, content, eventId? }
  const broadcastPayload = {
    title: payload.title,
    content: payload.content || payload.message,
    eventId: payload.eventId
  };

  if (targetRooms.length === 0) {
    io.emit('emergency_alert', broadcastPayload);
  } else {
    io.to(targetRooms).emit('emergency_alert', broadcastPayload);
  }
};

module.exports = {
  initSocket,
  getIO,
  sendSocketNotification,
  broadcastEventUpdate,
  broadcastAttendeeCount,
  broadcastEmergencyAlert
};
