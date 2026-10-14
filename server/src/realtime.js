const { Server } = require('socket.io');
const config = require('./config');
const db = require('./db');
const { verifyAccessToken } = require('./auth');

let io;
const connectedUsers = new Map();

function isBlocked(firstUserId, secondUserId) {
  return Boolean(db.prepare(`
    SELECT 1 FROM blocks
    WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
  `).get(firstUserId, secondUserId, secondUserId, firstUserId));
}

function visibleContactIds(userId) {
  return db.prepare(`
    SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS user_id
    FROM friendships f
    WHERE status = 'accepted'
      AND (requester_id = ? OR addressee_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = ? AND b.blocked_id =
          CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END)
          OR (b.blocked_id = ? AND b.blocker_id =
          CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END)
      )
  `).all(userId, userId, userId, userId, userId, userId, userId).map((row) => row.user_id);
}

function publishPresence(userId, online) {
  if (!io) return;
  const user = db.prepare('SELECT username, last_seen_at FROM users WHERE id = ?').get(userId);
  if (!user) return;
  const payload = {
    userId,
    username: user.username,
    online,
    lastSeenAt: user.last_seen_at
  };
  for (const contactId of visibleContactIds(userId)) {
    io.to(`user:${contactId}`).emit('presence:update', payload);
  }
}

function initRealtime(server) {
  io = new Server(server, {
    cors: { origin: config.clientOrigin, credentials: true },
    transports: ['websocket', 'polling']
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string') {
      next(new Error('Authentifizierung erforderlich.'));
      return;
    }
    try {
      const claims = verifyAccessToken(token);
      const user = db.prepare('SELECT auth_version, email_verified FROM users WHERE id = ?').get(claims.sub);
      const session = user && db.prepare(`
        SELECT 1 FROM sessions
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
      `).get(claims.sid, claims.sub, new Date().toISOString());
      if (!user || !user.email_verified || claims.ver !== user.auth_version || !session) {
        next(new Error('Sitzung ungültig.'));
        return;
      }
      socket.data.userId = claims.sub;
      socket.data.sessionId = claims.sid;
      socket.data.expiresAt = claims.exp * 1000;
      next();
    } catch (error) {
      next(new Error(error.message));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(socket.data.expiresAt - Date.now(), 0));
    expiryTimer.unref();
    let sockets = connectedUsers.get(userId);
    const wasOffline = !sockets || sockets.size === 0;
    if (!sockets) {
      sockets = new Set();
      connectedUsers.set(userId, sockets);
    }
    sockets.add(socket.id);
    socket.join(`user:${userId}`);

    const conversations = db.prepare(`
      SELECT own.conversation_id
      FROM conversation_members own
      JOIN conversations c ON c.id = own.conversation_id
      WHERE own.user_id = ?
        AND (
          c.type = 'group'
          OR NOT EXISTS (
            SELECT 1
            FROM conversation_members other
            JOIN blocks b ON
              (b.blocker_id = ? AND b.blocked_id = other.user_id)
              OR (b.blocker_id = other.user_id AND b.blocked_id = ?)
            WHERE other.conversation_id = c.id AND other.user_id <> ?
          )
        )
        AND (
          NOT EXISTS (SELECT 1 FROM channels channel WHERE channel.id = own.conversation_id)
          OR EXISTS (
            SELECT 1
            FROM channels channel
            JOIN server_members member
              ON member.server_id = channel.server_id AND member.user_id = own.user_id
            JOIN server_roles role ON role.id = member.role_id
            WHERE channel.id = own.conversation_id
              AND COALESCE(json_extract(role.permissions, '$.read_messages'), 0) = 1
          )
        )
    `).all(userId, userId, userId, userId);
    for (const conversation of conversations) {
      socket.join(`conversation:${conversation.conversation_id}`);
    }
    if (wasOffline) publishPresence(userId, true);

    socket.use((packet, next) => {
      if (Date.now() >= socket.data.expiresAt) {
        socket.disconnect(true);
        next(new Error('Sitzung abgelaufen.'));
        return;
      }
      next();
    });

    socket.on('typing:set', (payload = {}) => {
      if (typeof payload.conversationId !== 'string') return;
      const member = db.prepare(`
        SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?
      `).get(payload.conversationId, userId);
      if (!member) return;
      const conversation = db.prepare(`
        SELECT type FROM conversations WHERE id = ?
      `).get(payload.conversationId);
      if (!conversation) return;
      const serverRole = db.prepare(`
        SELECT sr.permissions
        FROM channels c
        JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = ?
        JOIN server_roles sr ON sr.id = sm.role_id
        WHERE c.id = ?
      `).get(userId, payload.conversationId);
      if (serverRole) {
        const permissions = JSON.parse(serverRole.permissions);
        if (permissions.read_messages !== true || permissions.send_messages !== true) return;
      } else if (db.prepare('SELECT 1 FROM channels WHERE id = ?').get(payload.conversationId)) {
        return;
      }
      if (conversation.type === 'direct') {
        const blockedPeer = db.prepare(`
          SELECT 1 FROM conversation_members other
          JOIN blocks b ON
            (b.blocker_id = ? AND b.blocked_id = other.user_id)
            OR (b.blocker_id = other.user_id AND b.blocked_id = ?)
          WHERE other.conversation_id = ? AND other.user_id <> ?
        `).get(userId, userId, payload.conversationId, userId);
        if (blockedPeer) return;
      }
      const username = db.prepare('SELECT username FROM users WHERE id = ?').get(userId)?.username;
      socket.to(`conversation:${payload.conversationId}`).emit('typing:update', {
        conversationId: payload.conversationId,
        userId,
        username,
        active: Boolean(payload.active)
      });
    });

    // ── WebRTC Signaling: Audio / Video / Bildschirmübertragung ──
    socket.on('call:initiate', (payload = {}) => {
      const { conversationId, targetUserId, withVideo, isScreenShare } = payload;
      if (!conversationId || !targetUserId) return;
      if (isBlocked(userId, targetUserId)) return;

      const caller = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
      if (!caller) return;

      io.to(`user:${targetUserId}`).emit('call:incoming', {
        conversationId,
        fromUserId: userId,
        fromUsername: caller.username,
        withVideo: Boolean(withVideo),
        isScreenShare: Boolean(isScreenShare)
      });
    });

    socket.on('call:accept', (payload = {}) => {
      const { conversationId, targetUserId } = payload;
      if (!conversationId || !targetUserId) return;

      io.to(`user:${targetUserId}`).emit('call:accepted', {
        conversationId,
        fromUserId: userId
      });
    });

    socket.on('call:reject', (payload = {}) => {
      const { conversationId, targetUserId, reason } = payload;
      if (!conversationId || !targetUserId) return;

      io.to(`user:${targetUserId}`).emit('call:rejected', {
        conversationId,
        fromUserId: userId,
        reason: reason || 'declined'
      });
    });

    socket.on('call:signal', (payload = {}) => {
      const { targetUserId, signalData, conversationId } = payload;
      if (!targetUserId || !signalData) return;

      io.to(`user:${targetUserId}`).emit('call:signal', {
        fromUserId: userId,
        conversationId,
        signalData
      });
    });

    socket.on('call:end', (payload = {}) => {
      const { targetUserId, conversationId } = payload;
      if (targetUserId) {
        io.to(`user:${targetUserId}`).emit('call:ended', {
          fromUserId: userId,
          conversationId
        });
      }
      if (conversationId) {
        socket.to(`conversation:${conversationId}`).emit('call:ended', {
          fromUserId: userId,
          conversationId
        });
      }
    });

    socket.on('disconnect', () => {
      clearTimeout(expiryTimer);
      const currentSockets = connectedUsers.get(userId);
      if (!currentSockets) return;
      currentSockets.delete(socket.id);
      if (currentSockets.size > 0) return;
      connectedUsers.delete(userId);
      db.prepare('UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
      publishPresence(userId, false);
    });
  });

  return io;
}

function emitConversation(conversationId, event, payload) {
  if (io) io.to(`conversation:${conversationId}`).emit(event, payload);
}

function notifyUser(userId, event, payload) {
  if (io) io.to(`user:${userId}`).emit(event, payload);
}

function joinConversation(conversationId, userIds) {
  if (!io) return;
  for (const userId of userIds) {
    io.in(`user:${userId}`).socketsJoin(`conversation:${conversationId}`);
  }
}

function removeFromConversation(conversationId, userIds) {
  if (!io) return;
  for (const userId of userIds) {
    io.in(`user:${userId}`).socketsLeave(`conversation:${conversationId}`);
  }
}

function isOnline(userId) {
  return Boolean(connectedUsers.get(userId)?.size);
}

function onlineUserIds() {
  return new Set(connectedUsers.keys());
}

function disconnectUser(userId) {
  const sockets = connectedUsers.get(userId);
  if (!sockets) return;
  for (const socketId of sockets) {
    io?.sockets.sockets.get(socketId)?.disconnect(true);
  }
}

function disconnectSession(sessionId) {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.sessionId === sessionId) socket.disconnect(true);
  }
}

module.exports = {
  disconnectUser,
  disconnectSession,
  emitConversation,
  initRealtime,
  isBlocked,
  isOnline,
  joinConversation,
  removeFromConversation,
  notifyUser,
  onlineUserIds
};
