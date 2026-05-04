const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');
const { updateProfilePicture, getUserProfile, updateProfile, getPublicProfile } = require('../controllers/userController');

// @desc    Update User Profile (name only)
// @route   PUT /api/users/profile
// @route   PATCH /api/users/profile
// @access  Private
router.route('/profile')
    .put(protect, updateProfile)
    .patch(protect, updateProfile)
    .get(protect, getUserProfile);

// @desc    Update Profile Picture
// @route   POST /api/users/profile/picture
// @access  Private
router.post('/profile/picture', protect, upload.single('profilePicture'), updateProfilePicture);

// @desc    Get User Dashboard
// @route   GET /api/users/dashboard
// @access  Private/User
router.get('/dashboard', protect, authorize('user'), (req, res) => {
    res.json({ message: 'Welcome to the User Dashboard' });
});

// @desc    Get Public Organizer Profile (no auth required)
// @route   GET /api/users/public/:id
// @access  Public
router.get('/public/:id', getPublicProfile);

module.exports = router;
