const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please add a title'],
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Please add a description'],
    },
    date: {
      type: Date,
      required: [true, 'Please add a date'],
    },
    location: {
      type: String,
      required: [true, 'Please add a location'],
    },
    category: {
      type: String,
      required: [true, 'Please add a category'],
    },
    ticketPrice: {
      type: Number,
      required: [true, 'Please add a ticket price'],
      default: 0,
    },
    ticketQuantity: {
      type: Number,
      required: [true, 'Please add ticket quantity'],
    },
    totalTickets: {
      type: Number,
    },
    soldTickets: {
      type: Number,
      default: 0,
    },
    bannerImage: {
      url: String,
      public_id: String,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    organizer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    attendees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    status: {
      type: String,
      enum: ['active', 'cancelled', 'resubmitted'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

// Analytics performance indexes
eventSchema.index({ organizer: 1, date: -1 });
eventSchema.index({ category: 1 });

module.exports = mongoose.model('Event', eventSchema);
