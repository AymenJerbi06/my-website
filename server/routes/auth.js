const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcrypt');
const crypto   = require('crypto');
const { body, validationResult } = require('express-validator');
const { queryOne, run, query } = require('../db');

function makeSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

const SALT_ROUNDS = 12;

// Always normalize email the same way in both signup and login
function normalizeEmail(raw) {
  return raw.trim().toLowerCase();
}

// ── POST /api/auth/signup ──────────────────────────────────
router.post('/signup', [
  body('email').trim().isEmail().withMessage('Please enter a valid email address.'),
  body('password')
    .isLength({ min: 8 })  .withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/)      .withMessage('Password must contain at least one uppercase letter.')
    .matches(/[0-9]/)      .withMessage('Password must contain at least one number.'),
  body('confirmPassword').custom((val, { req }) => {
    if (val !== req.body.password) throw new Error('Passwords do not match.');
    return true;
  }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const email = normalizeEmail(req.body.email);
  const { password } = req.body;

  try {
    const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await queryOne(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
      [email, password_hash]
    );

    const token = makeSessionToken();
    await run('UPDATE users SET active_session_token = $1 WHERE id = $2', [token, user.id]);

    req.session.userId       = user.id;
    req.session.email        = email;
    req.session.sessionToken = token;
    return res.status(201).json({ success: true, redirect: '/dashboard' });

  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// ── POST /api/auth/login ───────────────────────────────────
router.post('/login', [
  body('email').trim().isEmail().withMessage('Please enter a valid email address.'),
  body('password').notEmpty().withMessage('Password is required.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const email = normalizeEmail(req.body.email);
  const { password } = req.body;

  try {
    const user = await queryOne('SELECT * FROM users WHERE email = $1', [email]);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
    }
    if (user.is_banned) {
      return res.status(403).json({ success: false, message: 'This account has been suspended.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
    }

    const token = makeSessionToken();
    await run('UPDATE users SET active_session_token = $1, last_seen_at = NOW() WHERE id = $2', [token, user.id]);

    req.session.userId       = user.id;
    req.session.email        = email;
    req.session.sessionToken = token;

    // If already in an active session, send straight there instead of dashboard
    const activeMatch = await queryOne(
      "SELECT id, mode FROM matches WHERE (sharer_id=$1 OR listener_id=$1) AND status='active'",
      [user.id]
    );
    const redirect = activeMatch
      ? (activeMatch.mode === 'video' ? `/video/${activeMatch.id}/prejoin` : `/chat/${activeMatch.id}`)
      : '/dashboard';

    return res.json({ success: true, redirect });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// ── POST /api/auth/logout ──────────────────────────────────
router.post('/logout', async (req, res) => {
  const userId = req.session?.userId;
  if (userId) {
    await run('UPDATE users SET active_session_token = NULL WHERE id = $1', [userId]).catch(() => {});
  }
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false });
    res.clearCookie('connect.sid');
    return res.json({ success: true, redirect: '/' });
  });
});

// ── GET /api/auth/me ───────────────────────────────────────
router.get('/me', async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ authenticated: false });
  }

  const user = await queryOne(
    'SELECT id, email, username, created_at, preferred_role, preferred_mode FROM users WHERE id = $1',
    [req.session.userId]
  ).catch(() => null);

  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ authenticated: false });
  }

  return res.json({ authenticated: true, user });
});

module.exports = router;
