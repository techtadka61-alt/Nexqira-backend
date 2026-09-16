const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');

// Load env BEFORE importing any routes/services that might read process.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const postRoutes = require('./routes/postRoutes');
const newsRoutes = require('./routes/newsRoutes');
const blogRoutes = require('./routes/blogRoutes');
const imageRoutes = require('./routes/imageRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const adminRoutes = require('./routes/adminRoutes');
const contactRoutes = require('./routes/contactRoutes');
const chatbotRoutes = require('./routes/chatbotRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();
const API_PREFIX = '/api/v1';

app.use(helmet());

// Configure CORS
const staticAllowedOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://www.nexqira.online',
  'https://nexqira.online',
  'https://aayam-ai-admin.vercel.app',
  'https://nexqira-admin.vercel.app/'
]);

if (process.env.FRONTEND_ORIGIN) {
  staticAllowedOrigins.add(String(process.env.FRONTEND_ORIGIN).trim());
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (curl, server-to-server)
      if (!origin) return callback(null, true);

      if (staticAllowedOrigins.has(origin)) return callback(null, true);

      // In development, allow any localhost/127.0.0.1 port (Vite can change ports)
      if (process.env.NODE_ENV !== 'production') {
        if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
          return callback(null, true);
        }
      }

      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

app.use(express.json());
app.use(mongoSanitize());

// Serve uploaded assets (best-effort; on serverless this may be ephemeral)
app.use(
  '/uploads',
  (req, res, next) => {
    // Allow images (e.g. http://localhost:5000/uploads/...) to be embedded by the admin UI
    // running on a different origin (e.g. http://localhost:3000).
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(path.join(process.cwd(), 'uploads'))
);

// Health (no DB required)
app.get(`${API_PREFIX}/health`, (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Ensure DB connection for all API requests
app.use(async (req, res, next) => {
  // Skip DB for health checks
  if (req.path === `${API_PREFIX}/health`) return next();
  try {
    await connectDB();
    next();
  } catch (err) {
    const safeMessage =
      process.env.NODE_ENV && String(process.env.NODE_ENV).toLowerCase() === 'production'
        ? 'Database connection failed'
        : err?.message || 'Database connection failed';
    res.status(500).json({ success: false, message: safeMessage });
  }
});

// Routes
// Rate-limit login endpoints (basic brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false
});

app.use(`${API_PREFIX}/auth`, authLimiter, authRoutes);
app.use(`${API_PREFIX}/posts`, postRoutes);
app.use(`${API_PREFIX}/news`, newsRoutes);
app.use(`${API_PREFIX}/blog`, blogRoutes);
app.use(`${API_PREFIX}/images`, imageRoutes);
app.use(`${API_PREFIX}/uploads`, uploadRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);
app.use(`${API_PREFIX}/contact`, contactRoutes);
app.use(`${API_PREFIX}/chatbot`, chatbotRoutes);
app.use(`${API_PREFIX}/analytics`, analyticsRoutes);
app.use(`${API_PREFIX}/dashboard`, dashboardRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

module.exports = app;
