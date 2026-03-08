const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const passport = require('passport');

// Passport config (safe to always load — no side-effects beyond setting strategy)
require('./config/passport');

// ─────────────────────────────────────────────────────────────────────────────
// Detect execution environment.
// On Vercel, VERCEL=1 is always injected automatically.
// ─────────────────────────────────────────────────────────────────────────────
const IS_SERVERLESS = process.env.VERCEL === '1';

// ─────────────────────────────────────────────────────────────────────────────
// In serverless mode, we do NOT spin up a persistent HTTP server, Socket.io,
// cron jobs, or the seed script at module-load time.  All of those require a
// long-lived process which Vercel's Lambda runtime does NOT provide.
//
// Instead we initialise them ONLY when running locally (NODE_ENV !== production
// OR no VERCEL env var set).
// ─────────────────────────────────────────────────────────────────────────────
const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL]
  : ['http://localhost:5173'];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// ── Stripe Webhook (MUST be before express.json to receive raw body) ──────────
const { stripeWebhook } = require('./controllers/bookingController');
app.post(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  stripeWebhook
);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: false }));

// ── Passport ──────────────────────────────────────────────────────────────────
app.use(passport.initialize());

// ── Lazy DB connection ────────────────────────────────────────────────────────
// In serverless we cannot guarantee connectDB() finishes before the first
// request arrives (module-level calls are not awaited). This middleware runs
// connectDB before every request — connectDB itself caches the promise so it
// only creates one real connection.
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('DB connection failed:', err.message);
    res.status(503).json({ error: 'Database unavailable. Please try again.' });
  }
});

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const mongoose = require('mongoose');
  const mongoStatus = mongoose.connection.readyState === 1 ? 'up' : 'down';
  const httpStatus = mongoStatus === 'up' ? 200 : 503;

  res.status(httpStatus).json({
    status: httpStatus === 200 ? 'healthy' : 'unhealthy',
    timestamp: new Date(),
    serverless: IS_SERVERLESS,
    services: { database: mongoStatus },
  });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/authRoutes'));
app.use('/api/admin',         require('./routes/adminRoutes'));
app.use('/api/users',         require('./routes/userRoutes'));
app.use('/api/organizers',    require('./routes/organizerRoutes'));
app.use('/api/events',        require('./routes/eventRoutes'));
app.use('/api/bookings',      require('./routes/bookingRoutes'));
app.use('/api/tickets',       require('./routes/ticketRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));

app.get('/', (req, res) => {
  res.json({ message: 'EventBoost Pro API is running.' });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Local development only — spin up the full HTTP server + Socket.io + cron
// ─────────────────────────────────────────────────────────────────────────────
if (!IS_SERVERLESS) {
  const http = require('http');
  const { initSocket } = require('./config/socket');
  const { startReminderCron } = require('./services/reminderScheduler');
  const seedAdmin = require('./scripts/seedAdmin');

  const server = http.createServer(app);
  initSocket(server);

  const PORT = process.env.PORT || 5000;

  // Connect DB, seed admin, start cron, then listen
  connectDB()
    .then(() => seedAdmin())
    .then(() => {
      startReminderCron();
      server.listen(PORT, () =>
        console.log(
          `Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`
        )
      );
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}

// ── Export app for Vercel serverless handler ──────────────────────────────────
module.exports = app;