const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  const { name, email, password } = req.body;

  try {
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Please add all fields' });
    }

    // Validate Email: Normal users must use Gmail
    const isGmail = email.endsWith('@gmail.com');
    // Admin can create organizers with yahoo, but this is a public register route for users
    // Requirement: "Normal users can register only with Gmail accounts."
    // Requirement matches: admin creates organizers.
    if (!isGmail) {
      return res.status(400).json({ message: 'Registration is restricted to @gmail.com accounts.' });
    }

    // Check if user exists
    const userExists = await User.findOne({ email });

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
      role: 'user', // Default role
    });

    if (user) {
      res.status(201).json({
        _id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    if (error.code === 11000) {
        return res.status(400).json({ message: 'Email already exists' });
    }
    console.log(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Authenticate a user
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });

    if (user && (await user.matchPassword(password))) {
      res.json({
        _id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Google Auth Callback
// @route   GET /api/auth/google/callback
// @access  Public
const googleAuthCallback = (req, res) => {
    // Defines what happens after passport successfully authenticates
    // The user is in req.user
    const token = generateToken(req.user._id);
    
    // Use FRONTEND_URL from env, fallback to localhost:5173 if not set
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    
    // Redirect to frontend with token
    res.redirect(`${frontendUrl}/auth-success?token=${token}`);
};


// @desc    Get user data
// @route   GET /api/users/me
// @access  Private
const getMe = async (req, res) => {
  res.status(200).json(req.user);
};

// @desc    Forgot Password
// @route   POST /api/auth/forgot-password
// @access  Public
// @desc    Forgot Password (OTP)
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
    const { email } = req.body;

    let user;
    try {
        user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Hash OTP and save to DB
        user.resetOtp = crypto
            .createHash('sha256')
            .update(otp)
            .digest('hex');

        user.resetOtpExpire = Date.now() + 5 * 60 * 1000; // 5 minutes

        await user.save();

        const message = `Your Password Reset OTP is: ${otp}\n\nIt is valid for 5 minutes.`;

        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
             console.log('Reset Password OTP:', otp);
             return res.status(200).json({ message: 'OTP sent (checked console in dev mode)' });
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: 'Password Reset OTP',
            text: message,
        });

        res.status(200).json({ success: true, data: 'OTP sent to email' });
    } catch (error) {
        console.error(error);
        if (user) {
            user.resetOtp = undefined;
            user.resetOtpExpire = undefined;
            await user.save({ validateBeforeSave: false });
        }
        res.status(500).json({ message: 'Email could not be sent' });
    }
};

// @desc    Verify OTP
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOtp = async (req, res) => {
    const { email, otp } = req.body;

    try {
        const hashedOtp = crypto
            .createHash('sha256')
            .update(otp)
            .digest('hex');

        const user = await User.findOne({
            email,
            resetOtp: hashedOtp,
            resetOtpExpire: { $gt: Date.now() },
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        res.status(200).json({ success: true, data: 'OTP verified' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// @desc    Reset Password
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res) => {
    const { email, otp, password } = req.body;

    try {
        const hashedOtp = crypto
            .createHash('sha256')
            .update(otp)
            .digest('hex');

        const user = await User.findOne({
            email,
            resetOtp: hashedOtp,
            resetOtpExpire: { $gt: Date.now() },
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        user.password = password;
        user.resetOtp = undefined;
        user.resetOtpExpire = undefined;

        await user.save();

        res.status(200).json({
            success: true,
            data: 'Password updated success',
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = {
  registerUser,
  loginUser,
  getMe,
  googleAuthCallback,
  forgotPassword,
  verifyOtp,
  resetPassword
};
