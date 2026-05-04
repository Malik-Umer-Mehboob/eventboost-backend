const mongoose = require('mongoose');
const Review = require('../models/Review');
const Event = require('../models/Event');
const User = require('../models/User');

/**
 * Recalculates and updates the averageRating and totalReviews on an Event document.
 */
const updateEventRating = async (eventId) => {
  const result = await Review.aggregate([
    { $match: { event: new mongoose.Types.ObjectId(eventId) } },
    { $group: { _id: '$event', avg: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);

  const avg = result[0]?.avg ? parseFloat(result[0].avg.toFixed(1)) : 0;
  const count = result[0]?.count || 0;

  await Event.findByIdAndUpdate(eventId, {
    averageRating: avg,
    totalReviews: count,
  });

  return { avg, count };
};

/**
 * Recalculates and updates the averageRating and totalReviews on the organizer's User document.
 */
const updateOrganizerRating = async (organizerId) => {
  const result = await Review.aggregate([
    { $match: { organizer: new mongoose.Types.ObjectId(organizerId) } },
    { $group: { _id: '$organizer', avg: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);

  const avg = result[0]?.avg ? parseFloat(result[0].avg.toFixed(1)) : 0;
  const count = result[0]?.count || 0;

  await User.findByIdAndUpdate(organizerId, {
    averageRating: avg,
    totalReviews: count,
  });
};

module.exports = { updateEventRating, updateOrganizerRating };
