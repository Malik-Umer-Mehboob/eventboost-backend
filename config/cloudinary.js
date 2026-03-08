const cloudinary = require('cloudinary').v2;
const dotenv = require('dotenv');

dotenv.config();

console.log('Initializing Cloudinary with:');
console.log('- Cloud Name:', process.env.CLOUDINARY_CLOUD_NAME);
console.log('- API Key:', process.env.CLOUDINARY_API_KEY ? '****' + process.env.CLOUDINARY_API_KEY.slice(-4) : 'MISSING');

if (!process.env.CLOUDINARY_API_KEY) {
  console.error('CRITICAL: CLOUDINARY_API_KEY is missing from environment variables!');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;
