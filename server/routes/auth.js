const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcrypt');
const { body, validationResult } = require('express-validator');
const db       = require('../db');

const SALT_ROUNDS = 12;

// ── POST /api/auth/signup ──────────────────────────────────
router.post('/signup', [
  body('email')
    .trim().isEmail().withMessage('Please enter a valid email address.')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })  .withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/)      .withMessage('Password must contain at least one uppercase letter.')
    .matches(/[0-9]/)      .withMessage('Password must contain at least one number.'),
  body('confirmPassword')
    .custom((val, { req }) => {
      if (val !== req.body.password) throw new Error('Passwords do not match.');
      return true;
    }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { email, password } = req.body;

  try {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = db.prepare(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)'
    ).run(email, password_hash);

    req.session.userId = result.lastInsertRowid;
    req.session.email  = email;

    return res.status(201).json({ success: true, redirect: '/dashboard' });

  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// ── POST /api/auth/login ───────────────────────────────────
router.post('/login', [
  body('email')
    .trim().isEmail().withMessage('Please enter a valid email address.')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { email, password } = req.body;

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

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

    db.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?").run(user.id);

    req.session.userId = user.id;
    req.session.email  = user.email;

    return res.json({ success: true, redirect: '/dashboard' });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// ── POST /api/auth/logout ──────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false });
    res.clearCookie('connect.sid');
    return res.json({ success: true, redirect: '/' });
  });
});

// ── GET /api/auth/me ───────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ authenticated: false });
  }

  const user = db.prepare(
    'SELECT id, email, created_at, preferred_role, preferred_mode FROM users WHERE id = ?'
  ).get(req.session.userId);

  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ authenticated: false });
  }

  return res.json({ authenticated: true, user });
});

module.exports = router;
