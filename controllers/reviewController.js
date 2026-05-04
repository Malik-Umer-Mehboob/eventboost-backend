const mongoose = require('mongoose');
const Review = require('../models/Review');
const Event = require('../models/Event');
const Booking = require('../models/Booking');
const { updateEventRating, updateOrganizerRating } = require('../utils/ratingCalculator');

// @desc    Submit a review for an event
// @route   POST /api/reviews/:eventId
// @access  Private
const submitReview = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { rating, comment } = req.body;
    const userId = req.user.id;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
    }

    // 1. Verify event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: 'Event not found.' });
    }

    // 2. Check the event date has passed
    if (new Date(event.date) > new Date()) {
      return res.status(400).json({ message: 'You can only review an event after it has taken place.' });
    }

    // 3. Check user has a paid ticket
    const booking = await Booking.findOne({
      user: userId,
      event: eventId,
      paymentStatus: 'paid',
    });
    if (!booking) {
      return res.status(403).json({ message: 'Only verified ticket holders can submit a review.' });
    }

    // 4. Check user hasn't already reviewed this event
    const existing = await Review.findOne({ event: eventId, user: userId });
    if (existing) {
      return res.status(400).json({ message: 'You have already submitted a review for this event.' });
    }

    // 5. Create the review
    const review = await Review.create({
      event: eventId,
      organizer: event.organizer,
      user: userId,
      rating,
      comment: comment || '',
      isVerifiedAttendee: true,
    });

    // 6. Update ratings
    await updateEventRating(eventId);
    await updateOrganizerRating(event.organizer);

    // 7. Populate user for response
    const populated = await Review.findById(review._id)
      .populate('user', 'name profilePicture');

    res.status(201).json(populated);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'You have already submitted a review for this event.' });
    }
    console.error('Error in submitReview:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all reviews for an event
// @route   GET /api/reviews/event/:eventId
// @access  Public
const getEventReviews = async (req, res) => {
  try {
    const { eventId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      Review.find({ event: eventId })
        .populate('user', 'name profilePicture')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Review.countDocuments({ event: eventId }),
    ]);

    // Get rating distribution
    const distribution = await Review.aggregate([
      { $match: { event: new mongoose.Types.ObjectId(eventId) } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]);

    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    distribution.forEach(d => { dist[d._id] = d.count; });

    res.json({
      reviews,
      total,
      page,
      pages: Math.ceil(total / limit),
      distribution: dist,
    });
  } catch (error) {
    console.error('Error in getEventReviews:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all reviews for an organizer
// @route   GET /api/reviews/organizer/:organizerId
// @access  Public
const getOrganizerReviews = async (req, res) => {
  try {
    const { organizerId } = req.params;
    const limit = parseInt(req.query.limit) || 5;

    const reviews = await Review.find({ organizer: organizerId })
      .populate('user', 'name profilePicture')
      .populate('event', 'title date')
      .sort({ createdAt: -1 })
      .limit(limit);

    const total = await Review.countDocuments({ organizer: organizerId });

    res.json({ reviews, total });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Check if current user has reviewed an event
// @route   GET /api/reviews/my-review/:eventId
// @access  Private
const getMyReview = async (req, res) => {
  try {
    const review = await Review.findOne({
      event: req.params.eventId,
      user: req.user.id,
    });
    res.json(review || null);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Edit own review
// @route   PUT /api/reviews/:reviewId
// @access  Private
const updateReview = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const review = await Review.findById(req.params.reviewId);

    if (!review) return res.status(404).json({ message: 'Review not found.' });
    if (review.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to edit this review.' });
    }

    if (rating) review.rating = rating;
    if (comment !== undefined) review.comment = comment;
    await review.save();

    await updateEventRating(review.event);
    await updateOrganizerRating(review.organizer);

    const populated = await Review.findById(review._id).populate('user', 'name profilePicture');
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Delete own review (or admin)
// @route   DELETE /api/reviews/:reviewId
// @access  Private
const deleteReview = async (req, res) => {
  try {
    const review = await Review.findById(req.params.reviewId);
    if (!review) return res.status(404).json({ message: 'Review not found.' });

    const isOwner = review.user.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized to delete this review.' });
    }

    const { event: eventId, organizer: organizerId } = review;
    await review.deleteOne();

    await updateEventRating(eventId);
    await updateOrganizerRating(organizerId);

    res.json({ message: 'Review deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { submitReview, getEventReviews, getOrganizerReviews, getMyReview, updateReview, deleteReview };
