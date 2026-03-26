const express = require('express');
const router  = express.Router({ mergeParams: true });
const { queryOne, query, run, pool } = require('../db');

// Helper: load match and verify the requesting user belongs to it.
async function loadMatch(req, res) {
  const matchId = parseInt(req.params.matchId, 10);
  if (!matchId) { res.status(400).json({ success: false, message: 'Invalid match ID.' }); return null; }

  const match = await queryOne('SELECT * FROM matches WHERE id = $1', [matchId]);
  if (!match) { res.status(404).json({ success: false, message: 'Match not found.' }); return null; }

  const userId = req.session.userId;
  if (match.sharer_id !== userId && match.listener_id !== userId) {
    res.status(403).json({ success: false, message: 'You do not belong to this match.' });
    return null;
  }
  return match;
}

// ── GET /api/matches/:matchId ──────────────────────────────
router.get('/', async (req, res) => {
  const match = await loadMatch(req, res);
  if (!match) return;

  const userId    = req.session.userId;
  const role      = match.sharer_id === userId ? 'sharer' : 'listener';
  const partnerId = match.sharer_id === userId ? match.listener_id : match.sharer_id;

  const partner = await queryOne('SELECT username FROM users WHERE id = $1', [partnerId]);

  return res.json({
    id:               match.id,
    mode:             match.mode,
    status:           match.status,
    role,
    started_at:       match.started_at,
    ended_at:         match.ended_at,
    partner_username: partner?.username || null,
  });
});

// ── GET /api/matches/:matchId/messages ────────────────────
router.get('/messages', async (req, res) => {
  const match = await loadMatch(req, res);
  if (!match) return;

  const userId   = req.session.userId;
  const messages = await query(
    'SELECT id, sender_id, content, created_at FROM messages WHERE match_id = $1 ORDER BY created_at ASC, id ASC',
    [match.id]
  );

  return res.json(messages.map(m => ({
    id:         m.id,
    content:    m.content,
    created_at: m.created_at,
    mine:       m.sender_id === userId,
  })));
});

// ── POST /api/matches/:matchId/messages ───────────────────
router.post('/messages', async (req, res) => {
  const match = await loadMatch(req, res);
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

  const message = await queryOne(
    'INSERT INTO messages (match_id, sender_id, content) VALUES ($1, $2, $3) RETURNING id, content, created_at',
    [match.id, req.session.userId, content]
  );

  return res.status(201).json({
    id:         message.id,
    content:    message.content,
    created_at: message.created_at,
    mine:       true,
  });
});

// ── POST /api/matches/:matchId/leave ──────────────────────
router.post('/leave', async (req, res) => {
  const match = await loadMatch(req, res);
  if (!match) return;

  if (match.status !== 'active') {
    return res.json({ success: true, redirect: '/dashboard' });
  }

  await run("UPDATE matches SET status='ended', ended_at=NOW() WHERE id=$1", [match.id]);
  return res.json({ success: true, redirect: '/dashboard' });
});

// ── POST /api/matches/:matchId/leave-beacon ───────────────
// sendBeacon-compatible leave (iOS Safari pagehide — POST only).
router.post('/leave-beacon', async (req, res) => {
  const match = await loadMatch(req, res);
  if (!match) return;
  if (match.status === 'active') {
    await run("UPDATE matches SET status='ended', ended_at=NOW() WHERE id=$1", [match.id]);
  }
  return res.status(204).end();
});

// ── POST /api/matches/:matchId/ready ──────────────────────
router.post('/ready', async (req, res) => {
  const match = await loadMatch(req, res);
  if (!match) return;

  if (match.mode !== 'video') {
    return res.status(400).json({ success: false, message: 'Not a video session.' });
  }
  if (match.status !== 'active') {
    return res.status(400).json({ success: false, message: 'This session has ended.' });
  }

  const userId = req.session.userId;
  await run(
    'INSERT INTO video_readiness (match_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [match.id, userId]
  );

  const { rows } = await pool.query(
    'SELECT COUNT(*) AS n FROM video_readiness WHERE match_id = $1',
    [match.id]
  );
  const count = parseInt(rows[0].n, 10);

  return res.json({ success: true, bothReady: count >= 2 });
});

// ── GET /api/matches/:matchId/ready-status ────────────────
router.get('/ready-status', async (req, res) => {
  const match = await loadMatch(req, res);
  if (!match) return;

  const userId    = req.session.userId;
  const partnerId = match.sharer_id === userId ? match.listener_id : match.sharer_id;

  const youRow     = await queryOne('SELECT 1 FROM video_readiness WHERE match_id=$1 AND user_id=$2', [match.id, userId]);
  const partnerRow = await queryOne('SELECT 1 FROM video_readiness WHERE match_id=$1 AND user_id=$2', [match.id, partnerId]);

  const youReady     = !!youRow;
  const partnerReady = !!partnerRow;
  return res.json({ you: youReady, partner: partnerReady, bothReady: youReady && partnerReady });
});

// ── DELETE /api/matches/:matchId/ready ────────────────────
router.delete('/ready', async (req, res) => {
  const match = await loadMatch(req, res);
  if (!match) return;

  await run('DELETE FROM video_readiness WHERE match_id=$1 AND user_id=$2', [match.id, req.session.userId]);
  return res.json({ success: true });
});

// ── POST /api/matches/:matchId/report ─────────────────────
router.post('/report', async (req, res) => {
  const match = await loadMatch(req, res);
  if (!match) return;

  const { reason, details, endSession } = req.body;
  const validReasons = ['harassment', 'inappropriate', 'spam', 'other'];
  if (!validReasons.includes(reason)) {
    return res.status(400).json({ success: false, message: 'Invalid reason.' });
  }

  await run(
    'INSERT INTO reports (match_id, reporter_id, reason, details) VALUES ($1,$2,$3,$4)',
    [match.id, req.session.userId, reason, (details || '').trim() || null]
  );

  let sessionEnded = false;
  if (endSession && match.status === 'active') {
    await run("UPDATE matches SET status='ended', ended_at=NOW() WHERE id=$1", [match.id]);
    sessionEnded = true;
  }

  return res.json({ success: true, sessionEnded });
});

module.exports = router;
