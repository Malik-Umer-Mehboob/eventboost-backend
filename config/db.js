const mongoose = require('mongoose');

let cachedPromise = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (!cachedPromise) {
  cachedPromise = mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
  })
  .then((conn) => {
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  })
  .catch((error) => {
    cachedPromise = null;
    console.error(`MongoDB connection error: ${error.message}`);
    throw error;
  });  }

  return cachedPromise;
};

module.exports = connectDB;