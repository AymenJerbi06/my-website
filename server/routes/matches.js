const express = require('express');
const router  = express.Router({ mergeParams: true });
const db      = require('../db');

// Helper: load match and verify the requesting user belongs to it.
// Returns the match row, or sends a 403/404 and returns null.
function loadMatch(req, res) {
  const matchId = parseInt(req.params.matchId, 10);
  if (!matchId) { res.status(400).json({ success: false, message: 'Invalid match ID.' }); return null; }

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) { res.status(404).json({ success: false, message: 'Match not found.' }); return null; }

  const userId = req.session.userId;
  if (match.sharer_id !== userId && match.listener_id !== userId) {
    res.status(403).json({ success: false, message: 'You do not belong to this match.' });
    return null;
  }
  return match;
}

// ── GET /api/matches/:matchId ──────────────────────────────
// Returns match details (mode, status, your role, partner presence).
router.get('/', (req, res) => {
  const match = loadMatch(req, res);
  if (!match) return;

  const userId = req.session.userId;
  const role   = match.sharer_id === userId ? 'sharer' : 'listener';

  return res.json({
    id:         match.id,
    mode:       match.mode,
    status:     match.status,
    role,
    started_at: match.started_at,
    ended_at:   match.ended_at,
  });
});

// ── GET /api/matches/:matchId/messages ────────────────────
// Returns all messages for the match, oldest first.
// Each message includes a `mine` flag for easy frontend rendering.
router.get('/messages', (req, res) => {
  const match = loadMatch(req, res);
  if (!match) return;

  const userId   = req.session.userId;
  const messages = db.prepare(`
    SELECT id, sender_id, content, created_at
    FROM   messages
    WHERE  match_id = ?
    ORDER  BY created_at ASC, id ASC
  `).all(match.id);

  return res.json(messages.map(m => ({
    id:         m.id,
    content:    m.content,
    created_at: m.created_at,
    mine:       m.sender_id === userId,
  })));
});

// ── POST /api/matches/:matchId/messages ───────────────────
// Sends a message. Only allowed when match status = active.
router.post('/messages', (req, res) => {
  const match = loadMatch(req, res);
  if (!match) return;

  if (match.status !== 'active') {
    return res.status(400).json({ success: false, message: 'This session has ended.' });
  }

  const content = (req.body.content || '').trim();
  if (!content) {
    return res.status(400).json({ success: false, message: 'Message cannot be empty.' });
  }
  if (content.length > 2000) {
    return res.status(400).json({ success: false, message: 'Message is too long (max 2000 characters).' });
  }

  const result = db.prepare(
    'INSERT INTO messages (match_id, sender_id, content) VALUES (?, ?, ?)'
  ).run(match.id, req.session.userId, content);

  const message = db.prepare('SELECT id, sender_id, content, created_at FROM messages WHERE id = ?')
    .get(result.lastInsertRowid);

  return res.status(201).json({
    id:         message.id,
    content:    message.content,
    created_at: message.created_at,
    mine:       true,
  });
});

// ── POST /api/matches/:matchId/leave ──────────────────────
// Ends the match. Both users stop being able to send messages.
// Redirects the leaving user to /dashboard.
router.post('/leave', (req, res) => {
  const match = loadMatch(req, res);
  if (!match) return;

  if (match.status !== 'active') {
    // Already ended — that's fine, just send them home
    return res.json({ success: true, redirect: '/dashboard' });
  }

  db.prepare(
    "UPDATE matches SET status = 'ended', ended_at = datetime('now') WHERE id = ?"
  ).run(match.id);

  return res.json({ success: true, redirect: '/dashboard' });
});

// ── POST /api/matches/:matchId/leave-beacon ───────────────
// sendBeacon-compatible leave (iOS Safari pagehide).
router.post('/leave-beacon', (req, res) => {
  const match = loadMatch(req, res);
  if (!match) return;
  if (match.status === 'active') {
    db.prepare("UPDATE matches SET status='ended', ended_at=datetime('now') WHERE id=?").run(match.id);
  }
  return res.status(204).end();
});

// ── POST /api/matches/:matchId/ready ──────────────────────
// Marks the current user as ready in the video prejoin lobby.
// Returns { bothReady } so the client knows when to proceed.
router.post('/ready', (req, res) => {
  const match = loadMatch(req, res);
  if (!match) return;

  if (match.mode !== 'video') {
    return res.status(400).json({ success: false, message: 'Not a video session.' });
  }
  if (match.status !== 'active') {
    return res.status(400).json({ success: false, message: 'This session has ended.' });
  }

  const userId = req.session.userId;
  db.prepare(
    'INSERT OR REPLACE INTO video_readiness (match_id, user_id, ready_at) VALUES (?, ?, datetime(\'now\'))'
  ).run(match.id, userId);

  const count = db.prepare(
    'SELECT COUNT(*) AS n FROM video_readiness WHERE match_id = ?'
  ).get(match.id).n;

  return res.json({ success: true, bothReady: count >= 2 });
});

// ── GET /api/matches/:matchId/ready-status ────────────────
// Returns readiness for both participants (for prejoin polling).
router.get('/ready-status', (req, res) => {
  const match = loadMatch(req, res);
  if (!match) return;

  const userId    = req.session.userId;
  const partnerId = match.sharer_id === userId ? match.listener_id : match.sharer_id;

  const youReady     = !!db.prepare('SELECT 1 FROM video_readiness WHERE match_id = ? AND user_id = ?').get(match.id, userId);
  const partnerReady = !!db.prepare('SELECT 1 FROM video_readiness WHERE match_id = ? AND user_id = ?').get(match.id, partnerId);

  return res.json({ you: youReady, partner: partnerReady, bothReady: youReady && partnerReady });
});

// ── DELETE /api/matches/:matchId/ready ────────────────────
// Un-marks the current user's readiness (when leaving prejoin).
router.delete('/ready', (req, res) => {
  const match = loadMatch(req, res);
  if (!match) return;

  db.prepare('DELETE FROM video_readiness WHERE match_id = ? AND user_id = ?')
    .run(match.id, req.session.userId);

  return res.json({ success: true });
});

// ── POST /api/matches/:matchId/report ─────────────────────
// Submits a safety report for the session.
// Optionally ends the session immediately.
router.post('/report', (req, res) => {
  const match = loadMatch(req, res);
  if (!match) return;

  const { reason, details, endSession } = req.body;
  const validReasons = ['harassment', 'inappropriate', 'spam', 'other'];
  if (!validReasons.includes(reason)) {
    return res.status(400).json({ success: false, message: 'Invalid reason.' });
  }

  db.prepare(
    'INSERT INTO reports (match_id, reporter_id, reason, details) VALUES (?, ?, ?, ?)'
  ).run(match.id, req.session.userId, reason, (details || '').trim() || null);

  let sessionEnded = false;
  if (endSession && match.status === 'active') {
    db.prepare("UPDATE matches SET status = 'ended', ended_at = datetime('now') WHERE id = ?")
      .run(match.id);
    sessionEnded = true;
  }

  return res.json({ success: true, sessionEnded });
});

module.exports = router;
