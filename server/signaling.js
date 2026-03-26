const { queryOne, run } = require('./db');

module.exports = function setupSignaling(io) {

  io.use((socket, next) => {
    const userId = socket.request.session?.userId;
    if (!userId) return next(new Error('Not authenticated'));
    socket.userId = userId;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;

    socket.on('join-room', async ({ matchId }) => {
      matchId = parseInt(matchId, 10);
      if (!matchId) return;

      const match = await queryOne(`
        SELECT * FROM matches
        WHERE  id = $1
          AND  (sharer_id = $2 OR listener_id = $2)
          AND  status = 'active'
          AND  mode   = 'video'
      `, [matchId, userId]);

      if (!match) {
        socket.emit('error', { message: 'Cannot join this session.' });
        return;
      }

      socket.join(`match:${matchId}`);
      socket.matchId = matchId;

      const roomSize = io.sockets.adapter.rooms.get(`match:${matchId}`)?.size ?? 0;

      if (roomSize >= 2) {
        const otherSocketIds = [...(io.sockets.adapter.rooms.get(`match:${matchId}`) || [])]
          .filter(id => id !== socket.id);

        socket.emit('peer-ready', { initiator: match.sharer_id === userId });
        if (otherSocketIds.length > 0) {
          io.to(otherSocketIds[0]).emit('peer-ready', { initiator: match.sharer_id !== userId });
        }
      } else {
        socket.emit('waiting-for-peer');
      }
    });

    socket.on('offer', async ({ matchId, sdp }) => {
      if (!await verifyActive(userId, matchId)) return;
      socket.to(`match:${matchId}`).emit('offer', { sdp });
    });

    socket.on('answer', async ({ matchId, sdp }) => {
      if (!await verifyActive(userId, matchId)) return;
      socket.to(`match:${matchId}`).emit('answer', { sdp });
    });

    socket.on('ice-candidate', async ({ matchId, candidate }) => {
      if (!await verifyActive(userId, matchId)) return;
      socket.to(`match:${matchId}`).emit('ice-candidate', { candidate });
    });

    socket.on('end-session', async ({ matchId }) => {
      matchId = parseInt(matchId, 10);
      const match = await queryOne(
        "SELECT id FROM matches WHERE id=$1 AND (sharer_id=$2 OR listener_id=$2) AND status='active'",
        [matchId, userId]
      );
      if (!match) return;

      await run("UPDATE matches SET status='ended', ended_at=NOW() WHERE id=$1", [matchId]);
      io.to(`match:${matchId}`).emit('session-ended');
    });

    socket.on('disconnect', () => {
      if (socket.matchId) {
        socket.to(`match:${socket.matchId}`).emit('peer-disconnected');
      }
    });
  });

  async function verifyActive(userId, matchId) {
    matchId = parseInt(matchId, 10);
    if (!matchId) return false;
    const row = await queryOne(
      "SELECT id FROM matches WHERE id=$1 AND (sharer_id=$2 OR listener_id=$2) AND status='active'",
      [matchId, userId]
    );
    return !!row;
  }
};
