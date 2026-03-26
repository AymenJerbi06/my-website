require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const http    = require('http');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');
const path    = require('path');

require('./db');                          // initialises SQLite + schema on first run
const requireAuth    = require('./middleware/requireAuth');
const authRoutes     = require('./routes/auth');
const userRoutes     = require('./routes/user');
const queueRoutes    = require('./routes/queue');
const matchRoutes    = require('./routes/matches');
const setupSignaling = require('./signaling');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, { cors: { origin: false } });
const PORT       = process.env.PORT || 3000;

// ── Session middleware (shared with Socket.IO) ────────────
const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET env var is required in production.');
  process.exit(1);
}

// Trust the first proxy (Render, Railway, etc. terminate TLS)
if (isProd) app.set('trust proxy', 1);

const sessionMiddleware = session({
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    maxAge:   7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure:   isProd,   // HTTPS-only cookies in production
    sameSite: 'lax',
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

// Share express-session with Socket.IO
io.engine.use(sessionMiddleware);

// ── Signaling ─────────────────────────────────────────────
setupSignaling(io);

// ── Public API ────────────────────────────────────────────
app.use('/api/auth', authRoutes);

// ── Protected API ─────────────────────────────────────────
app.use('/api/user',             requireAuth, userRoutes);
app.use('/api/queue',            requireAuth, queueRoutes);
app.use('/api/matches/:matchId', requireAuth, matchRoutes);

// ── Protected pages ───────────────────────────────────────
app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard.html'));
});

app.get('/chat/:matchId', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../chat.html'));
});

app.get('/video/:matchId/prejoin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../video-prejoin.html'));
});

app.get('/video/:matchId', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../video.html'));
});

// ── Redirect logged-in users away from landing page ──────
app.get('/', (req, res, next) => {
  if (req.session?.userId) return res.redirect('/dashboard');
  next();
});

// ── Static files ──────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..'), { index: 'index.html' }));

// ── 404 ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '../index.html'));
});

// ── Start ─────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`✓ Supportly running → http://localhost:${PORT}`);
});
