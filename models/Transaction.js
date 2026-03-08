const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking'
  },
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'usd'
  },
  status: {
    type: String,
    enum: ['pending', 'succeeded', 'failed', 'refunded'],
    default: 'pending'
  },
  type: {
    type: String,
    enum: ['payment', 'refund'],
    default: 'payment'
  },
  stripePaymentIntentId: {
    type: String,
    unique: true,
    sparse: true
  },
  stripeSessionId: {
    type: String
  },
  paymentMethod: {
    type: String
  },
  metadata: {
    type: Map,
    of: String
  }
}, { timestamps: true });

// Indexing for performance
transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ event: 1 });
transactionSchema.index({ status: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
