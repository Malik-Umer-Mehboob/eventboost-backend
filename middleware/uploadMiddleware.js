const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

// Configure Cloudinary Storage
if (!cloudinary.config().api_key) {
  console.error('ERROR: Cloudinary is not configured in uploadMiddleware!');
}

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Determine folder based on fieldname or route
    let folder = 'eventboost/misc';
    if (file.fieldname === 'banner') folder = 'eventboost/events';
    if (file.fieldname === 'profilePicture') folder = 'eventboost/profiles';

    return {
      folder: folder,
      allowed_formats: ['jpg', 'png', 'jpeg'],
      transformation: [{ width: 1000, height: 1000, crop: 'limit' }], // Optimization
      public_id: `${Date.now()}-${file.originalname.split('.')[0]}`,
    };
  },
});

// File filter for extra safety
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

module.exports = upload;
