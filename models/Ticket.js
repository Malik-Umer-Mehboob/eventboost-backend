const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema(
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
    paymentId: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    ticketNumber: {
      type: String,
      required: true,
      unique: true,
    },
    qrCode: {
      type: String, // Data URL for the QR code
    },
    isValid: {
      type: Boolean,
      default: true,
    },
    paymentIntentId: {
      type: String,
    },
    refundStatus: {
      type: String,
      enum: ['none', 'refunded'],
      default: 'none',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Ticket', ticketSchema);
