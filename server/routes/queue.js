const express = require('express');
const router  = express.Router();
const { queryOne, query, run, pool } = require('../db');

// ── POST /api/queue/join ───────────────────────────────────
router.post('/join', async (req, res) => {
  const { role, mode } = req.body;

  if (!['sharer', 'listener'].includes(role)) {
    return res.status(400).json({ success: false, message: 'role must be sharer or listener.' });
  }
  if (!['text', 'video', 'either'].includes(mode)) {
    return res.status(400).json({ success: false, message: 'mode must be text, video, or either.' });
  }

  const userId       = req.session.userId;
  const oppositeRole = role === 'sharer' ? 'listener' : 'sharer';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Guard: user must not already be in an active match
    const activeMatch = await client.query(
      "SELECT id FROM matches WHERE (sharer_id=$1 OR listener_id=$1) AND status='active'",
      [userId]
    );
    if (activeMatch.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'You are already in an active session.',
        matchId: activeMatch.rows[0].id,
      });
    }

    // Cancel any stale waiting entry for this user
    await client.query(
      "UPDATE match_queue SET status='cancelled' WHERE user_id=$1 AND status='waiting'",
      [userId]
    );

    // Find compatible waiting partner
    const partnerRes = await client.query(`
      SELECT mq.*
      FROM   match_queue mq
      WHERE  mq.status  = 'waiting'
        AND  mq.role    = $1
        AND  mq.user_id != $2
        AND  (mq.mode = $3 OR mq.mode = 'either' OR $3 = 'either')
        AND  NOT EXISTS (
               SELECT 1 FROM matches m
               WHERE  (m.sharer_id = mq.user_id OR m.listener_id = mq.user_id)
                 AND  m.status = 'active'
             )
      ORDER BY mq.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `, [oppositeRole, userId, mode]);

    if (partnerRes.rows.length > 0) {
      const partner    = partnerRes.rows[0];
      const actualMode = (mode === 'video' || partner.mode === 'video') ? 'video' : 'text';
      const sharerId   = role === 'sharer'   ? userId : partner.user_id;
      const listenerId = role === 'listener' ? userId : partner.user_id;

      const matchRes = await client.query(
        'INSERT INTO matches (sharer_id, listener_id, mode) VALUES ($1,$2,$3) RETURNING id',
        [sharerId, listenerId, actualMode]
      );
      const matchId = matchRes.rows[0].id;

      await client.query(
        "UPDATE match_queue SET status='matched', match_id=$1 WHERE id=$2",
        [matchId, partner.id]
      );
      await client.query(
        "INSERT INTO match_queue (user_id, role, mode, status, match_id) VALUES ($1,$2,$3,'matched',$4)",
        [userId, role, mode, matchId]
      );

      await client.query('COMMIT');
      return res.json({ success: true, matched: true, matchId, mode: actualMode });
    }

    // No partner — enter queue as waiting
    const queueRes = await client.query(
      'INSERT INTO match_queue (user_id, role, mode) VALUES ($1,$2,$3) RETURNING id',
      [userId, role, mode]
    );
    await client.query('COMMIT');
    return res.json({ success: true, matched: false, queueId: queueRes.rows[0].id });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Queue join error:', err);
    return res.status(500).json({ success: false, message: 'Could not join queue.' });
  } finally {
    client.release();
  }
});

// ── GET /api/queue/status ──────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const entry = await queryOne(`
      SELECT q.status, q.match_id, m.mode AS match_mode
      FROM   match_queue q
      LEFT JOIN matches m ON m.id = q.match_id
      WHERE  q.user_id = $1
        AND  (
               q.status = 'waiting'
               OR (q.status = 'matched' AND m.status = 'active')
             )
      ORDER BY q.created_at DESC
      LIMIT 1
    `, [req.session.userId]);

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
router.delete('/leave', async (req, res) => {
  try {
    await run(
      "UPDATE match_queue SET status='cancelled' WHERE user_id=$1 AND status='waiting'",
      [req.session.userId]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('Queue leave error:', err);
    return res.status(500).json({ success: false });
  }
});

module.exports = router;
