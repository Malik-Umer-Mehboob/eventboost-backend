const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: function() { return !this.googleId; }, // Password required if not Google Auth
    minlength: 8,
  },
  role: {
    type: String,
    enum: ['user', 'organizer', 'admin'],
    default: 'user',
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true, // Allows null/undefined to be ignored for uniqueness
  },
  resetOtp: String,
  resetOtpExpire: Date,
  profilePicture: {
    url: { type: String, default: '' },
    public_id: { type: String, default: '' }
  },
  status: {
    type: String,
    enum: ['active', 'blocked'],
    default: 'active',
  },
}, {
  timestamps: true,
});

// Encrypt password using bcrypt
userSchema.pre('save', async function() {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);

module.exports = User;
