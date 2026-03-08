const mongoose = require('mongoose');

// Cache the connection promise to reuse across serverless invocations.
// This avoids opening a new connection on every cold start.
let cachedPromise = null;

const connectDB = async () => {
  // If already connected, return immediately
  if (mongoose.connection.readyState === 1) {
    return;
  }

  // Reuse an in-flight connection promise
  if (!cachedPromise) {
    cachedPromise = mongoose
      .connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 10000, // 10 s – keep low for serverless
        socketTimeoutMS: 45000,
      })
      .then((conn) => {
        console.log(`MongoDB Connected: ${conn.connection.host}`);
        return conn;
      })
      .catch((error) => {
        // Clear cache so next call retries instead of replaying a failed promise
        cachedPromise = null;
        // Do NOT call process.exit() – that crashes the serverless runtime!
        console.error(`MongoDB connection error: ${error.message}`);
        throw error;
      });
  }

  return cachedPromise;
};

module.exports = connectDB;
