const mongoose = require('mongoose');

const waitlistSchema = new mongoose.Schema({
  event: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Event', 
    required: true 
  },
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  position: { 
    type: Number, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['waiting', 'notified', 'expired', 'converted'], 
    default: 'waiting' 
  },
  notifiedAt: { 
    type: Date 
  },
  expiresAt: { 
    type: Date 
  },
}, { timestamps: true });

// Ensure a user can only be on the waitlist once for a specific event
waitlistSchema.index({ event: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('Waitlist', waitlistSchema);
