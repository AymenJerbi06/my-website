const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ── POST /api/queue/join ───────────────────────────────────
// Matching rules (ALL must be true):
//   1. Not the same user
//   2. Opposite roles (one sharer, one listener)
//   3. Both queue rows have status = 'waiting'
//   4. Neither user is already in an active match
//   5. Formats are compatible:
//        either  ↔  text   → ok   (resolved as text)
//        either  ↔  video  → ok   (resolved as video)
//        either  ↔  either → ok   (resolved as text)
//        text    ↔  text   → ok
//        video   ↔  video  → ok
//        text    ↔  video  → NO MATCH
router.post('/join', (req, res) => {
  const { role, mode } = req.body;

  if (!['sharer', 'listener'].includes(role)) {
    return res.status(400).json({ success: false, message: 'role must be sharer or listener.' });
  }
  if (!['text', 'video', 'either'].includes(mode)) {
    return res.status(400).json({ success: false, message: 'mode must be text, video, or either.' });
  }

  const userId       = req.session.userId;
  const oppositeRole = role === 'sharer' ? 'listener' : 'sharer';

  // Guard: user must not already be in an active match
  const activeMatch = db.prepare(
    "SELECT id FROM matches WHERE (sharer_id = ? OR listener_id = ?) AND status = 'active'"
  ).get(userId, userId);
  if (activeMatch) {
    return res.status(409).json({
      success: false,
      message: 'You are already in an active session.',
      matchId: activeMatch.id,
    });
  }

  try {
    const result = db.transaction(() => {
      // Cancel any stale waiting entry for this user
      db.prepare(
        "UPDATE match_queue SET status = 'cancelled' WHERE user_id = ? AND status = 'waiting'"
      ).run(userId);

      // Find one compatible waiting partner.
      // Conditions checked explicitly:
      //   - opposite role
      //   - not this user
      //   - status = waiting
      //   - not already in an active match
      //   - format compatible (either matches anything; text↔text; video↔video)
      const partner = db.prepare(`
        SELECT mq.*
        FROM   match_queue mq
        WHERE  mq.status  = 'waiting'
          AND  mq.role    = ?
          AND  mq.user_id != ?
          AND  (mq.mode = ? OR mq.mode = 'either' OR ? = 'either')
          AND  NOT EXISTS (
                 SELECT 1 FROM matches m
                 WHERE  (m.sharer_id = mq.user_id OR m.listener_id = mq.user_id)
                   AND  m.status = 'active'
               )
        ORDER BY mq.created_at ASC
        LIMIT 1
      `).get(oppositeRole, userId, mode, mode);

      if (partner) {
        // Resolve actual mode:
        //   if either side explicitly wants video → video
        //   otherwise → text
        const actualMode = (mode === 'video' || partner.mode === 'video') ? 'video' : 'text';

        const sharerId   = role === 'sharer'   ? userId : partner.user_id;
        const listenerId = role === 'listener' ? userId : partner.user_id;

        // Create the match (atomic with the queue updates below)
        const matchResult = db.prepare(
          'INSERT INTO matches (sharer_id, listener_id, mode) VALUES (?, ?, ?)'
        ).run(sharerId, listenerId, actualMode);
        const matchId = matchResult.lastInsertRowid;

        // Move partner's queue row to matched
        db.prepare(
          "UPDATE match_queue SET status = 'matched', match_id = ? WHERE id = ?"
        ).run(matchId, partner.id);

        // Insert current user's queue row as matched (never went through waiting)
        db.prepare(
          "INSERT INTO match_queue (user_id, role, mode, status, match_id) VALUES (?, ?, ?, 'matched', ?)"
        ).run(userId, role, mode, matchId);

        return { matched: true, matchId, mode: actualMode };
      }

      // No compatible partner — enter queue as waiting
      const queueResult = db.prepare(
        'INSERT INTO match_queue (user_id, role, mode) VALUES (?, ?, ?)'
      ).run(userId, role, mode);

      return { matched: false, queueId: queueResult.lastInsertRowid };
    })();

    return res.json({ success: true, ...result });

  } catch (err) {
    console.error('Queue join error:', err);
    return res.status(500).json({ success: false, message: 'Could not join queue.' });
  }
});

// ── GET /api/queue/status ──────────────────────────────────
// Single source of truth: the queue table.
// Only looks at rows that are still active (waiting or matched).
router.get('/status', (req, res) => {
  try {
    const entry = db.prepare(`
      SELECT q.status, q.match_id, m.mode AS match_mode
      FROM   match_queue q
      LEFT JOIN matches m ON m.id = q.match_id
      WHERE  q.user_id = ?
        AND  (
               q.status = 'waiting'
               OR (q.status = 'matched' AND m.status = 'active')
             )
      ORDER BY q.created_at DESC
      LIMIT 1
    `).get(req.session.userId);

    if (!entry) return res.json({ inQueue: false });

    if (entry.status === 'matched') {
      return res.json({ inQueue: true, matched: true, matchId: entry.match_id, mode: entry.match_mode });
    }
    return res.json({ inQueue: true, matched: false });

  } catch (err) {
    console.error('Queue status error:', err);
    return res.status(500).json({ success: false });
  }
});

// ── DELETE /api/queue/leave ────────────────────────────────
router.delete('/leave', (req, res) => {
  try {
    db.prepare(
      "UPDATE match_queue SET status = 'cancelled' WHERE user_id = ? AND status = 'waiting'"
    ).run(req.session.userId);
    return res.json({ success: true });
  } catch (err) {
    console.error('Queue leave error:', err);
    return res.status(500).json({ success: false });
  }
});

module.exports = router;
