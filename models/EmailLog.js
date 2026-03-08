const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema({
  recipientEmail: {
    type: String,
    required: true
  },
  subject: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['reminder', 'announcement', 'ticket_confirmation', 'event_update'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'failed'],
    default: 'pending'
  },
  error: {
    type: String
  },
  retryCount: {
    type: Number,
    default: 0
  },
  lastAttempt: {
    type: Date,
    default: Date.now
  },
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event'
  },
  idempotencyKey: {
    type: String,
    unique: true,
    sparse: true
  }
}, { timestamps: true });

// Index for status and type for analytics/monitoring
emailLogSchema.index({ status: 1, type: 1 });
emailLogSchema.index({ recipientEmail: 1, createdAt: -1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);
