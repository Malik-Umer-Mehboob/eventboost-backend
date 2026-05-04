const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  event: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Event', 
    required: true 
  },
  organizer: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  rating: { 
    type: Number, 
    required: true, 
    min: 1, 
    max: 5 
  },
  comment: { 
    type: String, 
    maxlength: 500,
    default: '' 
  },
  isVerifiedAttendee: { 
    type: Boolean, 
    default: true 
  },
}, { timestamps: true });

// One review per user per event
reviewSchema.index({ event: 1, user: 1 }, { unique: true });
// Fast organizer-based queries
reviewSchema.index({ organizer: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
