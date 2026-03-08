const User = require('../models/User');
const Event = require('../models/Event');

// @desc    Get organizer profile
// @route   GET /api/organizers/profile
// @access  Private/Organizer
const getOrganizerProfile = async (req, res) => {
  try {
    const organizer = await User.findById(req.user.id).select('-password');
    if (!organizer) {
      return res.status(404).json({ message: 'Organizer not found' });
    }

    // Fetch basic stats
    const totalEvents = await Event.countDocuments({ organizer: req.user.id });
    const events = await Event.find({ organizer: req.user.id }).select('title date ticketQuantity soldTickets');
    
    // Calculate total sold and revenue (simplified)
    const stats = events.reduce((acc, event) => {
      acc.totalSold += (event.soldTickets || 0);
      // acc.totalRevenue += (event.soldTickets || 0) * (event.ticketPrice || 0); // Need price from event model
      return acc;
    }, { totalSold: 0 });

    res.json({
      _id: organizer._id,
      name: organizer.name,
      email: organizer.email,
      role: organizer.role,
      profilePicture: organizer.profilePicture,
      stats: {
        totalEvents,
        totalSoldTickets: stats.totalSold,
      },
      events
    });
  } catch (error) {
    console.error('Error fetching organizer profile:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update organizer profile (name only)
// @route   PATCH /api/organizers/profile
// @access  Private/Organizer
const updateOrganizerProfile = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Name is required' });
    }

    const organizer = await User.findByIdAndUpdate(
      req.user.id,
      { name },
      { returnDocument: 'after', runValidators: true }
    ).select('-password');

    if (!organizer) {
      return res.status(404).json({ message: 'Organizer not found' });
    }

    res.json(organizer);
  } catch (error) {
    console.error('Error updating organizer profile:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getOrganizerProfile,
  updateOrganizerProfile,
};
