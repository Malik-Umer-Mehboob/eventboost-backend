const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    stripeSessionId: {
      type: String,
    },
    qrCode: {
      type: String, // Data URL for the QR code
    },
    refundStatus: {
      type: String,
      enum: ['none', 'requested', 'completed'],
      default: 'none',
    },
  },
  {
    timestamps: true,
  }
);

// Analytics performance indexes
bookingSchema.index({ event: 1, paymentStatus: 1 });
bookingSchema.index({ user: 1, createdAt: -1 });
bookingSchema.index({ createdAt: -1, paymentStatus: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
