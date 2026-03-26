/**
 * WebRTC signaling over Socket.IO.
 *
 * Room name: `match:<matchId>`
 * Each room holds exactly two authenticated users.
 *
 * Protocol:
 *   1. Both users connect and emit `join-room`
 *   2. When room reaches 2 peers, server emits `peer-ready` to both
 *      – the sharer receives { initiator: true }  → creates the SDP offer
 *      – the listener receives { initiator: false } → waits for the offer
 *   3. Sharer emits `offer { matchId, sdp }`
 *      → relayed to listener as `offer { sdp }`
 *   4. Listener emits `answer { matchId, sdp }`
 *      → relayed to sharer as `answer { sdp }`
 *   5. Both sides exchange `ice-candidate { matchId, candidate }`
 *      → relayed to the other peer
 *   6. Either side emits `end-session { matchId }`
 *      → DB updated, `session-ended` broadcast to the room
 */

const db = require('./db');

module.exports = function setupSignaling(io) {

  // ── Auth middleware ──────────────────────────────────────
  io.use((socket, next) => {
    const userId = socket.request.session?.userId;
    if (!userId) return next(new Error('Not authenticated'));
    socket.userId = userId;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;

    // ── join-room ──────────────────────────────────────────
    socket.on('join-room', ({ matchId }) => {
      matchId = parseInt(matchId, 10);
      if (!matchId) return;

      // Verify user belongs to this active video match
      const match = db.prepare(`
        SELECT * FROM matches
        WHERE  id = ?
          AND  (sharer_id = ? OR listener_id = ?)
          AND  status = 'active'
          AND  mode   = 'video'
      `).get(matchId, userId, userId);

      if (!match) {
        socket.emit('error', { message: 'Cannot join this session.' });
        return;
      }

      socket.join(`match:${matchId}`);
      socket.matchId = matchId;

      const roomSize = io.sockets.adapter.rooms.get(`match:${matchId}`)?.size ?? 0;

      if (roomSize >= 2) {
        // Tell each peer exactly once with the correct initiator flag.
        // Sharer creates the offer (initiator:true); listener waits (initiator:false).
        // We emit individually — never broadcast a blank event first.
        const otherSocketIds = [...(io.sockets.adapter.rooms.get(`match:${matchId}`) || [])]
          .filter(id => id !== socket.id);

        // The user who just joined
        socket.emit('peer-ready', { initiator: match.sharer_id === userId });

        // The user already in the room
        if (otherSocketIds.length > 0) {
          io.to(otherSocketIds[0]).emit('peer-ready', { initiator: match.sharer_id !== userId });
        }
      } else {
        socket.emit('waiting-for-peer');
      }
    });

    // ── SDP offer (sharer → listener) ─────────────────────
    socket.on('offer', ({ matchId, sdp }) => {
      if (!verifyActive(userId, matchId)) return;
      socket.to(`match:${matchId}`).emit('offer', { sdp });
    });

    // ── SDP answer (listener → sharer) ────────────────────
    socket.on('answer', ({ matchId, sdp }) => {
      if (!verifyActive(userId, matchId)) return;
      socket.to(`match:${matchId}`).emit('answer', { sdp });
    });

    // ── ICE candidate (both directions) ───────────────────
    socket.on('ice-candidate', ({ matchId, candidate }) => {
      if (!verifyActive(userId, matchId)) return;
      socket.to(`match:${matchId}`).emit('ice-candidate', { candidate });
    });

    // ── End session ────────────────────────────────────────
    socket.on('end-session', ({ matchId }) => {
      matchId = parseInt(matchId, 10);
      const match = db.prepare(`
        SELECT id FROM matches
        WHERE id = ? AND (sharer_id = ? OR listener_id = ?) AND status = 'active'
      `).get(matchId, userId, userId);

      if (!match) return;

      db.prepare("UPDATE matches SET status = 'ended', ended_at = datetime('now') WHERE id = ?")
        .run(matchId);

      io.to(`match:${matchId}`).emit('session-ended');
    });

    // ── Cleanup on disconnect ──────────────────────────────
    socket.on('disconnect', () => {
      if (socket.matchId) {
        socket.to(`match:${socket.matchId}`).emit('peer-disconnected');
      }
    });
  });

  // Helper — returns true if user belongs to an active match
  function verifyActive(userId, matchId) {
    matchId = parseInt(matchId, 10);
    if (!matchId) return false;
    return !!db.prepare(`
      SELECT id FROM matches
      WHERE id = ? AND (sharer_id = ? OR listener_id = ?) AND status = 'active'
    `).get(matchId, userId, userId);
  }
};
