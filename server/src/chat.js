const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const config = require('./config');

const REACTION_EMOJIS = new Set(['👍', '❤️', '😂', '😮', '😢', '🎉']);
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = new Map([
  ['image/jpeg', { extension: '.jpg', signature: (buffer) => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ['image/png', { extension: '.png', signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ['image/gif', { extension: '.gif', signature: (buffer) => ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6)) }],
  ['image/webp', { extension: '.webp', signature: (buffer) => buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' }],
  ['application/pdf', { extension: '.pdf', signature: (buffer) => buffer.toString('ascii', 0, 5) === '%PDF-' }],
  ['text/plain', { extension: '.txt', signature: (buffer) => !buffer.includes(0) }]
]);

function createChatRouter({ db, requireAuth, realtime }) {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ATTACHMENT_SIZE, files: 1, fields: 2, parts: 3 },
    fileFilter(req, file, callback) {
      if (!ATTACHMENT_TYPES.has(file.mimetype)) {
        callback(new Error('Dieser Dateityp wird nicht unterstützt.'));
        return;
      }
      callback(null, true);
    }
  });

  function relationshipExists(userId, otherId) {
    return Boolean(db.prepare(`
      SELECT 1 FROM friendships
      WHERE status = 'accepted'
        AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
    `).get(userId, otherId, otherId, userId));
  }

  function isBlocked(userId, otherId) {
    return Boolean(db.prepare(`
      SELECT 1 FROM blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
    `).get(userId, otherId, otherId, userId));
  }

  function getPeerForConversation(conversationId, userId) {
    return db.prepare(`
      SELECT u.id, u.username, u.last_seen_at
      FROM conversation_members mine
      JOIN conversation_members peer ON peer.conversation_id = mine.conversation_id AND peer.user_id <> mine.user_id
      JOIN users u ON u.id = peer.user_id
      WHERE mine.conversation_id = ? AND mine.user_id = ?
    `).get(conversationId, userId);
  }

  function isConversationMember(conversationId, userId) {
    return Boolean(db.prepare(`
      SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?
    `).get(conversationId, userId));
  }

  function conversationAvailable(conversationId, userId) {
    if (!isConversationMember(conversationId, userId)) return false;
    const conversation = db.prepare('SELECT type FROM conversations WHERE id = ?').get(conversationId);
    if (!conversation) return false;
    if (conversation.type === 'direct') {
      const peer = getPeerForConversation(conversationId, userId);
      if (!peer || isBlocked(userId, peer.id)) return false;
    }
    return true;
  }

  function createDirectConversation(firstUserId, secondUserId) {
    const existing = db.prepare(`
      SELECT c.id
      FROM conversations c
      JOIN conversation_members first_member
        ON first_member.conversation_id = c.id AND first_member.user_id = ?
      JOIN conversation_members second_member
        ON second_member.conversation_id = c.id AND second_member.user_id = ?
      WHERE c.type = 'direct'
        AND (SELECT COUNT(*) FROM conversation_members members WHERE members.conversation_id = c.id) = 2
      LIMIT 1
    `).get(firstUserId, secondUserId);
    if (existing) return existing.id;

    const conversationId = crypto.randomUUID();
    db.prepare('INSERT INTO conversations (id, type, created_by) VALUES (?, ?, ?)').run(conversationId, 'direct', firstUserId);
    const addMember = db.prepare(`
      INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'member')
    `);
    addMember.run(conversationId, firstUserId);
    addMember.run(conversationId, secondUserId);
    return conversationId;
  }

  function emitFriendshipChange(firstId, secondId, friendshipId, status) {
    const payload = { friendshipId, status };
    realtime.notifyUser(firstId, 'friendship:update', payload);
    realtime.notifyUser(secondId, 'friendship:update', payload);
  }

  function publicMessage(row, reactions = [], attachment = null) {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      senderUsername: row.sender_username,
      body: row.deleted_at ? '' : row.body,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      deletedAt: row.deleted_at,
      replyTo: row.reply_to ? {
        id: row.reply_to,
        body: row.reply_body,
        senderUsername: row.reply_sender_username,
        deletedAt: row.reply_deleted_at
      } : null,
      reactions,
      attachment,
      readCount: row.read_count || 0
    };
  }

  function getMessageReactions(messageIds, userId) {
    if (messageIds.length === 0) return new Map();
    const placeholders = messageIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT message_id, emoji, COUNT(*) AS count,
        MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS reacted_by_me
      FROM message_reactions
      WHERE message_id IN (${placeholders})
      GROUP BY message_id, emoji
      ORDER BY emoji
    `).all(userId, ...messageIds);
    const reactionsByMessage = new Map();
    for (const row of rows) {
      const reactions = reactionsByMessage.get(row.message_id) || [];
      reactions.push({
        emoji: row.emoji,
        count: row.count,
        reactedByMe: Boolean(row.reacted_by_me)
      });
      reactionsByMessage.set(row.message_id, reactions);
    }
    return reactionsByMessage;
  }

  function getMessageAttachments(messageIds) {
    if (messageIds.length === 0) return new Map();
    const placeholders = messageIds.map(() => '?').join(',');
    return new Map(db.prepare(`
      SELECT a.id, a.message_id, a.original_name, a.mime_type, a.size_bytes
      FROM message_attachments a
      WHERE a.message_id IN (${placeholders})
    `).all(...messageIds).map((row) => [row.message_id, {
      id: row.id,
      name: row.original_name,
      mimeType: row.mime_type,
      size: row.size_bytes,
      url: `/api/attachments/${row.id}`
    }]));
  }

  router.use(requireAuth);

  router.get('/users/search', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    if (query.length < 2 || query.length > 20) {
      res.status(400).json({ error: 'Die Suche muss 2 bis 20 Zeichen lang sein.' });
      return;
    }
    const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
    const users = db.prepare(`
      SELECT u.id, u.username
      FROM users u
      WHERE u.email_verified = 1 AND u.id <> ? AND u.username LIKE ? ESCAPE '\\'
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
             OR (b.blocker_id = u.id AND b.blocked_id = ?)
        )
      ORDER BY u.username
      LIMIT 20
    `).all(req.auth.sub, `%${escapedQuery}%`, req.auth.sub, req.auth.sub);
    res.json({
      users: users.map((user) => ({
        id: user.id,
        username: user.username,
        online: realtime.isOnline(user.id)
      }))
    });
  });

  router.get('/friendships', (req, res) => {
    const rows = db.prepare(`
      SELECT f.id, f.requester_id, f.addressee_id, f.status, f.created_at,
        u.id AS peer_id, u.username AS peer_username, u.last_seen_at AS peer_last_seen
      FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
      WHERE (f.requester_id = ? OR f.addressee_id = ?)
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
             OR (b.blocker_id = u.id AND b.blocked_id = ?)
        )
      ORDER BY f.created_at DESC
    `).all(req.auth.sub, req.auth.sub, req.auth.sub, req.auth.sub, req.auth.sub);
    const mapRow = (row, direction) => ({
      id: row.id,
      user: {
        id: row.peer_id,
        username: row.peer_username,
        online: realtime.isOnline(row.peer_id),
        lastSeenAt: row.peer_last_seen
      },
      direction,
      createdAt: row.created_at
    });
    res.json({
      incoming: rows.filter((row) => row.status === 'pending' && row.addressee_id === req.auth.sub).map((row) => mapRow(row, 'incoming')),
      outgoing: rows.filter((row) => row.status === 'pending' && row.requester_id === req.auth.sub).map((row) => mapRow(row, 'outgoing')),
      accepted: rows.filter((row) => row.status === 'accepted').map((row) => mapRow(row, 'accepted'))
    });
  });

  router.post('/friendships', (req, res) => {
    const username = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      res.status(400).json({ error: 'Gib einen gültigen Benutzernamen ein.' });
      return;
    }
    const target = db.prepare(`
      SELECT id, username FROM users WHERE username = ? AND email_verified = 1
    `).get(username);
    if (!target || target.id === req.auth.sub || isBlocked(req.auth.sub, target.id)) {
      res.status(404).json({ error: 'Nutzer nicht gefunden.' });
      return;
    }

    const existing = db.prepare(`
      SELECT id, requester_id, addressee_id, status
      FROM friendships
      WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
    `).get(req.auth.sub, target.id, target.id, req.auth.sub);
    if (existing?.status === 'accepted') {
      res.status(409).json({ error: 'Ihr seid bereits befreundet.' });
      return;
    }
    if (existing?.requester_id === req.auth.sub) {
      res.status(409).json({ error: 'Eine Anfrage an diesen Nutzer ist bereits offen.' });
      return;
    }

    if (existing) {
      const accept = db.transaction(() => {
        db.prepare(`
          UPDATE friendships SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(existing.id);
        return createDirectConversation(req.auth.sub, target.id);
      });
      const conversationId = accept();
      realtime.joinConversation(conversationId, [req.auth.sub, target.id]);
      emitFriendshipChange(req.auth.sub, target.id, existing.id, 'accepted');
      res.json({ friendshipId: existing.id, status: 'accepted', conversationId });
      return;
    }

    const friendshipId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO friendships (id, requester_id, addressee_id, status)
      VALUES (?, ?, ?, 'pending')
    `).run(friendshipId, req.auth.sub, target.id);
    emitFriendshipChange(req.auth.sub, target.id, friendshipId, 'pending');
    res.status(201).json({ friendshipId, status: 'pending', username: target.username });
  });

  router.post('/friendships/:id/accept', (req, res) => {
    const friendship = db.prepare(`
      SELECT id, requester_id, addressee_id, status FROM friendships WHERE id = ?
    `).get(req.params.id);
    if (!friendship || friendship.addressee_id !== req.auth.sub || friendship.status !== 'pending') {
      res.status(404).json({ error: 'Offene Anfrage nicht gefunden.' });
      return;
    }
    if (isBlocked(req.auth.sub, friendship.requester_id)) {
      db.prepare('DELETE FROM friendships WHERE id = ?').run(friendship.id);
      res.status(409).json({ error: 'Diese Anfrage kann wegen einer Blockierung nicht angenommen werden.' });
      return;
    }
    const accept = db.transaction(() => {
      db.prepare(`
        UPDATE friendships SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(friendship.id);
      return createDirectConversation(req.auth.sub, friendship.requester_id);
    });
    const conversationId = accept();
    realtime.joinConversation(conversationId, [req.auth.sub, friendship.requester_id]);
    emitFriendshipChange(friendship.requester_id, req.auth.sub, friendship.id, 'accepted');
    res.json({ friendshipId: friendship.id, status: 'accepted', conversationId });
  });

  router.delete('/friendships/:id', (req, res) => {
    const friendship = db.prepare(`
      SELECT id, requester_id, addressee_id, status FROM friendships WHERE id = ?
    `).get(req.params.id);
    if (!friendship || (friendship.requester_id !== req.auth.sub && friendship.addressee_id !== req.auth.sub)) {
      res.status(404).json({ error: 'Kontakt oder Anfrage nicht gefunden.' });
      return;
    }
    db.prepare('DELETE FROM friendships WHERE id = ?').run(friendship.id);
    emitFriendshipChange(friendship.requester_id, friendship.addressee_id, friendship.id, 'removed');
    res.status(204).end();
  });

  router.get('/blocks', (req, res) => {
    const blocks = db.prepare(`
      SELECT b.blocked_id AS id, u.username, b.created_at
      FROM blocks b JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ? ORDER BY b.created_at DESC
    `).all(req.auth.sub);
    res.json({ blocks });
  });

  router.post('/blocks', (req, res) => {
    const blockedId = typeof req.body.userId === 'string' ? req.body.userId : '';
    const target = db.prepare('SELECT id FROM users WHERE id = ? AND email_verified = 1').get(blockedId);
    if (!target || blockedId === req.auth.sub) {
      res.status(404).json({ error: 'Nutzer nicht gefunden.' });
      return;
    }
    const createBlock = db.transaction(() => {
      db.prepare(`
        INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?)
        ON CONFLICT (blocker_id, blocked_id) DO NOTHING
      `).run(req.auth.sub, blockedId);
      db.prepare(`
        DELETE FROM friendships
        WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
      `).run(req.auth.sub, blockedId, blockedId, req.auth.sub);
    });
    createBlock();
    emitFriendshipChange(req.auth.sub, blockedId, null, 'blocked');
    res.status(201).json({ blocked: true });
  });

  router.delete('/blocks/:userId', (req, res) => {
    const result = db.prepare(`
      DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?
    `).run(req.auth.sub, req.params.userId);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Blockierung nicht gefunden.' });
      return;
    }
    realtime.notifyUser(req.auth.sub, 'friendship:update', { status: 'unblocked', userId: req.params.userId });
    res.status(204).end();
  });

  router.get('/conversations', (req, res) => {
    const conversations = db.prepare(`
      SELECT c.id, c.type, c.name, c.created_at,
        peer.id AS peer_id, peer.username AS peer_username, peer.last_seen_at AS peer_last_seen,
        (SELECT CASE WHEN m.body <> '' THEN m.body
          ELSE COALESCE((SELECT '📎 ' || a.original_name
            FROM message_attachments a WHERE a.message_id = m.id), '')
          END FROM messages m
          WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM message_deletions md
              WHERE md.message_id = m.id AND md.user_id = ?
            )
          ORDER BY m.created_at DESC LIMIT 1) AS last_message,
        (SELECT m.created_at FROM messages m
          WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM message_deletions md
              WHERE md.message_id = m.id AND md.user_id = ?
            )
          ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
        (SELECT COUNT(*) FROM messages m
          WHERE m.conversation_id = c.id AND m.sender_id <> ? AND m.deleted_at IS NULL
            AND (mine.last_read_at IS NULL OR m.created_at > mine.last_read_at)
            AND NOT EXISTS (
              SELECT 1 FROM message_deletions md
              WHERE md.message_id = m.id AND md.user_id = ?
            )) AS unread_count
      FROM conversation_members mine
      JOIN conversations c ON c.id = mine.conversation_id
      LEFT JOIN conversation_members peer_member
        ON c.type = 'direct' AND peer_member.conversation_id = c.id AND peer_member.user_id <> ?
      LEFT JOIN users peer ON peer.id = peer_member.user_id
      WHERE mine.user_id = ?
        AND (
          c.type = 'group'
          OR (
            peer.email_verified = 1
            AND NOT EXISTS (
              SELECT 1 FROM blocks b
              WHERE (b.blocker_id = ? AND b.blocked_id = peer.id)
                 OR (b.blocker_id = peer.id AND b.blocked_id = ?)
            )
          )
        )
      ORDER BY COALESCE(last_message_at, c.created_at) DESC
    `).all(
      req.auth.sub, req.auth.sub, req.auth.sub, req.auth.sub,
      req.auth.sub, req.auth.sub, req.auth.sub, req.auth.sub
    );
    res.json({
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        type: conversation.type,
        name: conversation.type === 'group' ? conversation.name : conversation.peer_username,
        peer: conversation.peer_id ? {
          id: conversation.peer_id,
          username: conversation.peer_username,
          online: realtime.isOnline(conversation.peer_id),
          lastSeenAt: conversation.peer_last_seen
        } : null,
        lastMessage: conversation.last_message,
        lastMessageAt: conversation.last_message_at || conversation.created_at,
        unreadCount: conversation.unread_count
      }))
    });
  });

  router.post('/conversations/direct', (req, res) => {
    const peerId = typeof req.body.userId === 'string' ? req.body.userId : '';
    if (!peerId || peerId === req.auth.sub || isBlocked(req.auth.sub, peerId)) {
      res.status(403).json({ error: 'Diese Unterhaltung kann nicht geöffnet werden.' });
      return;
    }
    if (!relationshipExists(req.auth.sub, peerId)) {
      res.status(403).json({ error: 'Du musst mit diesem Nutzer befreundet sein, um einen Chat zu starten.' });
      return;
    }
    const create = db.transaction(() => createDirectConversation(req.auth.sub, peerId));
    const conversationId = create();
    realtime.joinConversation(conversationId, [req.auth.sub, peerId]);
    res.status(201).json({ conversationId });
  });

  router.post('/groups', (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
    if (memberIds.length < 2 || memberIds.length > 49 || memberIds.some((id) => typeof id !== 'string' || id.length > 64)) {
      res.status(400).json({ error: 'Eine Gruppe benötigt 2 bis 49 gültige Nutzer-IDs.' });
      return;
    }
    const requestedMembers = [...new Set(memberIds)];
    if (name.length < 2 || name.length > 60) {
      res.status(400).json({ error: 'Der Gruppenname muss 2 bis 60 Zeichen lang sein.' });
      return;
    }
    if (requestedMembers.length < 2 || requestedMembers.length > 49 || requestedMembers.includes(req.auth.sub)) {
      res.status(400).json({ error: 'Eine Gruppe benötigt 2 bis 49 weitere Mitglieder.' });
      return;
    }
    const validUsers = db.prepare(`
      SELECT id FROM users WHERE email_verified = 1 AND id IN (${requestedMembers.map(() => '?').join(',')})
    `).all(...requestedMembers);
    if (validUsers.length !== requestedMembers.length || requestedMembers.some((id) =>
      isBlocked(req.auth.sub, id) || !relationshipExists(req.auth.sub, id))) {
      res.status(403).json({ error: 'Alle Gruppenmitglieder müssen bestätigte Kontakte ohne Blockierung sein.' });
      return;
    }

    const conversationId = crypto.randomUUID();
    const createGroup = db.transaction(() => {
      db.prepare(`
        INSERT INTO conversations (id, type, name, created_by) VALUES (?, 'group', ?, ?)
      `).run(conversationId, name, req.auth.sub);
      const insertMember = db.prepare(`
        INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)
      `);
      insertMember.run(conversationId, req.auth.sub, 'admin');
      for (const memberId of requestedMembers) insertMember.run(conversationId, memberId, 'member');
    });
    createGroup();
    realtime.joinConversation(conversationId, [req.auth.sub, ...requestedMembers]);
    for (const memberId of requestedMembers) {
      realtime.notifyUser(memberId, 'conversation:created', { conversationId, type: 'group', name });
    }
    res.status(201).json({ conversationId, name });
  });

  router.get('/groups/:id', (req, res) => {
    const group = db.prepare(`
      SELECT c.id, c.name, own.role AS my_role
      FROM conversations c
      JOIN conversation_members own ON own.conversation_id = c.id AND own.user_id = ?
      WHERE c.id = ? AND c.type = 'group'
    `).get(req.auth.sub, req.params.id);
    if (!group) {
      res.status(404).json({ error: 'Gruppe nicht gefunden.' });
      return;
    }
    const members = db.prepare(`
      SELECT u.id, u.username, cm.role, cm.joined_at
      FROM conversation_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ?
      ORDER BY CASE cm.role WHEN 'admin' THEN 0 ELSE 1 END, u.username COLLATE NOCASE
    `).all(group.id);
    res.json({
      group: {
        id: group.id,
        name: group.name,
        myRole: group.my_role,
        members: members.map((member) => ({
          id: member.id,
          username: member.username,
          role: member.role,
          joinedAt: member.joined_at,
          online: !realtime.isBlocked(req.auth.sub, member.id) && realtime.isOnline(member.id)
        }))
      }
    });
  });

  router.patch('/groups/:id', (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 2 || name.length > 60) {
      res.status(400).json({ error: 'Der Gruppenname muss 2 bis 60 Zeichen lang sein.' });
      return;
    }
    const isAdmin = db.prepare(`
      SELECT 1 FROM conversation_members cm
      JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.conversation_id = ? AND cm.user_id = ? AND cm.role = 'admin' AND c.type = 'group'
    `).get(req.params.id, req.auth.sub);
    if (!isAdmin) {
      res.status(403).json({ error: 'Nur Gruppen-Admins können den Gruppennamen ändern.' });
      return;
    }
    db.prepare('UPDATE conversations SET name = ? WHERE id = ?').run(name, req.params.id);
    realtime.emitConversation(req.params.id, 'group:updated', { conversationId: req.params.id, name });
    res.json({ name });
  });

  router.post('/groups/:id/members', (req, res) => {
    const isAdmin = db.prepare(`
      SELECT 1 FROM conversation_members cm
      JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.conversation_id = ? AND cm.user_id = ? AND cm.role = 'admin' AND c.type = 'group'
    `).get(req.params.id, req.auth.sub);
    if (!isAdmin) {
      res.status(403).json({ error: 'Nur Gruppen-Admins können Mitglieder hinzufügen.' });
      return;
    }
    const userId = typeof req.body.userId === 'string' ? req.body.userId : '';
    if (!userId || userId === req.auth.sub || !relationshipExists(req.auth.sub, userId) || isBlocked(req.auth.sub, userId)) {
      res.status(403).json({ error: 'Das neue Mitglied muss ein bestätigter Kontakt ohne Blockierung sein.' });
      return;
    }
    const memberCount = db.prepare(`
      SELECT COUNT(*) AS count FROM conversation_members WHERE conversation_id = ?
    `).get(req.params.id).count;
    if (memberCount >= 50) {
      res.status(409).json({ error: 'Gruppen sind auf 50 Mitglieder begrenzt.' });
      return;
    }
    try {
      db.prepare(`
        INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'member')
      `).run(req.params.id, userId);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        res.status(409).json({ error: 'Dieser Nutzer ist bereits Mitglied der Gruppe.' });
        return;
      }
      throw error;
    }
    realtime.joinConversation(req.params.id, [userId]);
    realtime.notifyUser(userId, 'conversation:created', { conversationId: req.params.id, type: 'group' });
    realtime.emitConversation(req.params.id, 'group:member-added', { conversationId: req.params.id, userId });
    res.status(201).json({ added: true });
  });

  router.patch('/groups/:id/members/:userId', (req, res) => {
    const isAdmin = db.prepare(`
      SELECT 1 FROM conversation_members cm
      JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.conversation_id = ? AND cm.user_id = ? AND cm.role = 'admin' AND c.type = 'group'
    `).get(req.params.id, req.auth.sub);
    if (!isAdmin || !['admin', 'member'].includes(req.body.role)) {
      res.status(403).json({ error: 'Nur Gruppen-Admins können die Rolle ändern.' });
      return;
    }
    const target = db.prepare(`
      SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?
    `).get(req.params.id, req.params.userId);
    if (!target) {
      res.status(404).json({ error: 'Gruppenmitglied nicht gefunden.' });
      return;
    }
    if (target.role === 'admin' && req.body.role === 'member') {
      const adminCount = db.prepare(`
        SELECT COUNT(*) AS count FROM conversation_members WHERE conversation_id = ? AND role = 'admin'
      `).get(req.params.id).count;
      if (adminCount <= 1) {
        res.status(409).json({ error: 'Die Gruppe muss mindestens einen Admin behalten.' });
        return;
      }
    }
    db.prepare(`
      UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?
    `).run(req.body.role, req.params.id, req.params.userId);
    realtime.emitConversation(req.params.id, 'group:role-updated', {
      conversationId: req.params.id,
      userId: req.params.userId,
      role: req.body.role
    });
    res.json({ userId: req.params.userId, role: req.body.role });
  });

  router.delete('/groups/:id/members/:userId', (req, res) => {
    const isMember = isConversationMember(req.params.id, req.auth.sub);
    if (!isMember) {
      res.status(404).json({ error: 'Gruppe nicht gefunden.' });
      return;
    }
    const group = db.prepare('SELECT type FROM conversations WHERE id = ?').get(req.params.id);
    if (!group || group.type !== 'group') {
      res.status(404).json({ error: 'Gruppe nicht gefunden.' });
      return;
    }
    const targetId = req.params.userId;
    const caller = db.prepare(`
      SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?
    `).get(req.params.id, req.auth.sub);
    if (targetId !== req.auth.sub && caller.role !== 'admin') {
      res.status(403).json({ error: 'Nur Admins können andere Mitglieder entfernen.' });
      return;
    }
    const target = db.prepare(`
      SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?
    `).get(req.params.id, targetId);
    if (!target) {
      res.status(404).json({ error: 'Gruppenmitglied nicht gefunden.' });
      return;
    }
    if (target.role === 'admin') {
      const adminCount = db.prepare(`
        SELECT COUNT(*) AS count FROM conversation_members WHERE conversation_id = ? AND role = 'admin'
      `).get(req.params.id).count;
      if (adminCount <= 1) {
        res.status(409).json({ error: 'Die Gruppe muss mindestens einen Admin behalten.' });
        return;
      }
    }
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(req.params.id, targetId);
    realtime.emitConversation(req.params.id, 'group:member-removed', { conversationId: req.params.id, userId: targetId });
    realtime.removeFromConversation(req.params.id, [targetId]);
    res.status(204).end();
  });

  router.get('/conversations/:id/messages', (req, res) => {
    if (!conversationAvailable(req.params.id, req.auth.sub)) {
      res.status(404).json({ error: 'Unterhaltung nicht gefunden.' });
      return;
    }
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    const messages = db.prepare(`
      SELECT m.id, m.conversation_id, m.sender_id, sender.username AS sender_username,
        m.body, m.created_at, m.edited_at, m.deleted_at, m.reply_to,
        reply.body AS reply_body, reply_user.username AS reply_sender_username, reply.deleted_at AS reply_deleted_at,
        (SELECT COUNT(*) FROM message_reads mr WHERE mr.message_id = m.id) AS read_count
      FROM messages m
      LEFT JOIN users sender ON sender.id = m.sender_id
      LEFT JOIN messages reply ON reply.id = m.reply_to
      LEFT JOIN users reply_user ON reply_user.id = reply.sender_id
      WHERE m.conversation_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM message_deletions md
          WHERE md.message_id = m.id AND md.user_id = ?
        )
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?
    `).all(req.params.id, req.auth.sub, limit);
    const orderedMessages = messages.reverse();
    const messageIds = orderedMessages.map((message) => message.id);
    const reactions = getMessageReactions(messageIds, req.auth.sub);
    const attachments = getMessageAttachments(messageIds);
    res.json({
      messages: orderedMessages.map((message) => publicMessage(
        message,
        reactions.get(message.id),
        attachments.get(message.id) || null
      ))
    });
  });

  router.post('/conversations/:id/attachments', (req, res, next) => {
    if (!conversationAvailable(req.params.id, req.auth.sub)) {
      res.status(404).json({ error: 'Unterhaltung nicht gefunden oder nicht verfügbar.' });
      return;
    }
    upload.single('file')(req, res, (error) => {
      if (!error) {
        next();
        return;
      }
      if (error instanceof multer.MulterError) {
        res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
          error: error.code === 'LIMIT_FILE_SIZE'
            ? 'Dateien dürfen höchstens 10 MB groß sein.'
            : 'Es kann jeweils nur eine Datei angehängt werden.'
        });
        return;
      }
      if (error.message === 'Dieser Dateityp wird nicht unterstützt.') {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    });
  }, (req, res) => {
    const conversationId = req.params.id;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Bitte wähle eine Datei aus.' });
      return;
    }
    const type = ATTACHMENT_TYPES.get(file.mimetype);
    if (!type || file.size === 0 || !type.signature(file.buffer)) {
      res.status(400).json({ error: 'Der Dateityp oder Dateiinhalt wird nicht unterstützt.' });
      return;
    }
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    const replyTo = typeof req.body.replyTo === 'string' ? req.body.replyTo : null;
    if (body.length > 4000) {
      res.status(400).json({ error: 'Der Nachrichtentext darf höchstens 4000 Zeichen lang sein.' });
      return;
    }
    if (replyTo && !db.prepare(`
      SELECT 1 FROM messages WHERE id = ? AND conversation_id = ?
    `).get(replyTo, conversationId)) {
      res.status(400).json({ error: 'Die beantwortete Nachricht gehört nicht zu dieser Unterhaltung.' });
      return;
    }

    const messageId = crypto.randomUUID();
    const attachmentId = crypto.randomUUID();
    const storageName = `${attachmentId}${type.extension}`;
    const originalName = path.basename(file.originalname.replace(/[\\/]/g, path.sep))
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 120) || `datei${type.extension}`;
    fs.mkdirSync(config.attachmentPath, { recursive: true });
    const filePath = path.join(config.attachmentPath, storageName);
    fs.writeFileSync(filePath, file.buffer, { flag: 'wx' });
    try {
      const saveAttachment = db.transaction(() => {
        db.prepare(`
          INSERT INTO messages (id, conversation_id, sender_id, body, reply_to, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(messageId, conversationId, req.auth.sub, body, replyTo, new Date().toISOString());
        db.prepare(`
          INSERT INTO message_attachments (id, message_id, storage_name, original_name, mime_type, size_bytes)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(attachmentId, messageId, storageName, originalName, file.mimetype, file.size);
      });
      saveAttachment();
    } catch (error) {
      fs.unlinkSync(filePath);
      throw error;
    }

    const message = db.prepare(`
      SELECT m.id, m.conversation_id, m.sender_id, sender.username AS sender_username,
        m.body, m.created_at, m.edited_at, m.deleted_at, m.reply_to,
        reply.body AS reply_body, reply_user.username AS reply_sender_username, reply.deleted_at AS reply_deleted_at,
        0 AS read_count
      FROM messages m
      LEFT JOIN users sender ON sender.id = m.sender_id
      LEFT JOIN messages reply ON reply.id = m.reply_to
      LEFT JOIN users reply_user ON reply_user.id = reply.sender_id
      WHERE m.id = ?
    `).get(messageId);
    const result = publicMessage(message, [], {
      id: attachmentId,
      name: originalName,
      mimeType: file.mimetype,
      size: file.size,
      url: `/api/attachments/${attachmentId}`
    });
    realtime.emitConversation(conversationId, 'message:new', result);
    res.status(201).json({ message: result });
  });

  router.get('/attachments/:id', (req, res, next) => {
    const attachment = db.prepare(`
      SELECT a.storage_name, a.original_name, a.mime_type, m.conversation_id
      FROM message_attachments a
      JOIN messages m ON m.id = a.message_id
      WHERE a.id = ? AND m.deleted_at IS NULL
    `).get(req.params.id);
    if (!attachment || !conversationAvailable(attachment.conversation_id, req.auth.sub)) {
      res.status(404).json({ error: 'Datei nicht gefunden oder nicht verfügbar.' });
      return;
    }
    const isImage = attachment.mime_type.startsWith('image/');
    res.setHeader('Content-Type', attachment.mime_type);
    res.setHeader('Content-Disposition', isImage ? 'inline' : 'attachment');
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(attachment.storage_name, { root: config.attachmentPath }, (error) => {
      if (error && !res.headersSent) next(error);
    });
  });

  router.post('/conversations/:id/messages', (req, res) => {
    const conversationId = req.params.id;
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    const replyTo = typeof req.body.replyTo === 'string' ? req.body.replyTo : null;
    if (!body || body.length > 4000) {
      res.status(400).json({ error: 'Eine Nachricht muss zwischen 1 und 4000 Zeichen lang sein.' });
      return;
    }
    if (!conversationAvailable(conversationId, req.auth.sub)) {
      res.status(404).json({ error: 'Unterhaltung nicht gefunden oder nicht verfügbar.' });
      return;
    }
    if (replyTo && !db.prepare(`
      SELECT 1 FROM messages WHERE id = ? AND conversation_id = ?
    `).get(replyTo, conversationId)) {
      res.status(400).json({ error: 'Die beantwortete Nachricht gehört nicht zu dieser Unterhaltung.' });
      return;
    }
    const messageId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, body, reply_to, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(messageId, conversationId, req.auth.sub, body, replyTo, new Date().toISOString());
    const message = db.prepare(`
      SELECT m.id, m.conversation_id, m.sender_id, sender.username AS sender_username,
        m.body, m.created_at, m.edited_at, m.deleted_at, m.reply_to,
        reply.body AS reply_body, reply_user.username AS reply_sender_username, reply.deleted_at AS reply_deleted_at,
        0 AS read_count
      FROM messages m
      LEFT JOIN users sender ON sender.id = m.sender_id
      LEFT JOIN messages reply ON reply.id = m.reply_to
      LEFT JOIN users reply_user ON reply_user.id = reply.sender_id
      WHERE m.id = ?
    `).get(messageId);
    const result = publicMessage(message);
    realtime.emitConversation(conversationId, 'message:new', result);
    res.status(201).json({ message: result });
  });

  router.patch('/messages/:id', (req, res) => {
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    if (!body || body.length > 4000) {
      res.status(400).json({ error: 'Eine Nachricht muss zwischen 1 und 4000 Zeichen lang sein.' });
      return;
    }
    const message = db.prepare(`
      SELECT id, conversation_id, sender_id, deleted_at FROM messages WHERE id = ?
    `).get(req.params.id);
    if (!message || message.sender_id !== req.auth.sub || message.deleted_at || !conversationAvailable(message.conversation_id, req.auth.sub)) {
      res.status(404).json({ error: 'Eigene Nachricht nicht gefunden oder nicht bearbeitbar.' });
      return;
    }
    db.prepare(`
      UPDATE messages SET body = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(body, message.id);
    const updated = db.prepare(`
      SELECT m.id, m.conversation_id, m.sender_id, sender.username AS sender_username,
        m.body, m.created_at, m.edited_at, m.deleted_at, m.reply_to,
        reply.body AS reply_body, reply_user.username AS reply_sender_username, reply.deleted_at AS reply_deleted_at,
        (SELECT COUNT(*) FROM message_reads mr WHERE mr.message_id = m.id) AS read_count
      FROM messages m
      LEFT JOIN users sender ON sender.id = m.sender_id
      LEFT JOIN messages reply ON reply.id = m.reply_to
      LEFT JOIN users reply_user ON reply_user.id = reply.sender_id
      WHERE m.id = ?
    `).get(message.id);
    const result = publicMessage(
      updated,
      getMessageReactions([message.id], req.auth.sub).get(message.id),
      getMessageAttachments([message.id]).get(message.id) || null
    );
    realtime.emitConversation(message.conversation_id, 'message:updated', result);
    res.json({ message: result });
  });

  router.post('/messages/:id/reactions', (req, res) => {
    const emoji = typeof req.body.emoji === 'string' ? req.body.emoji : '';
    if (!REACTION_EMOJIS.has(emoji)) {
      res.status(400).json({ error: 'Diese Reaktion wird nicht unterstützt.' });
      return;
    }
    const message = db.prepare(`
      SELECT id, conversation_id, deleted_at FROM messages WHERE id = ?
    `).get(req.params.id);
    if (!message || message.deleted_at || !conversationAvailable(message.conversation_id, req.auth.sub)) {
      res.status(404).json({ error: 'Nachricht nicht gefunden oder nicht verfügbar.' });
      return;
    }

    const existing = db.prepare(`
      SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?
    `).get(message.id, req.auth.sub, emoji);
    const active = !existing;
    if (active) {
      db.prepare(`
        INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)
      `).run(message.id, req.auth.sub, emoji);
    } else {
      db.prepare(`
        DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?
      `).run(message.id, req.auth.sub, emoji);
    }
    const reactions = getMessageReactions([message.id], req.auth.sub).get(message.id) || [];
    const reaction = reactions.find((item) => item.emoji === emoji);
    realtime.emitConversation(message.conversation_id, 'message:reaction', {
      id: message.id,
      conversationId: message.conversation_id,
      emoji,
      count: reaction?.count || 0,
      userId: req.auth.sub,
      active
    });
    res.json({ reactions });
  });

  router.delete('/messages/:id', (req, res) => {
    const scope = req.body?.scope;
    if (!['me', 'everyone'].includes(scope)) {
      res.status(400).json({ error: 'scope muss "me" oder "everyone" sein.' });
      return;
    }
    const message = db.prepare(`
      SELECT id, conversation_id, sender_id, deleted_at FROM messages WHERE id = ?
    `).get(req.params.id);
    if (!message || !conversationAvailable(message.conversation_id, req.auth.sub)) {
      res.status(404).json({ error: 'Nachricht nicht gefunden.' });
      return;
    }
    if (scope === 'everyone') {
      if (message.sender_id !== req.auth.sub) {
        res.status(403).json({ error: 'Du kannst nur eigene Nachrichten für alle löschen.' });
        return;
      }
      db.prepare(`
        UPDATE messages SET deleted_at = CURRENT_TIMESTAMP, body = '' WHERE id = ?
      `).run(message.id);
      const attachment = db.prepare(`
        SELECT storage_name FROM message_attachments WHERE message_id = ?
      `).get(message.id);
      if (attachment) {
        db.prepare('DELETE FROM message_attachments WHERE message_id = ?').run(message.id);
        fs.promises.unlink(path.join(config.attachmentPath, attachment.storage_name)).catch((error) => {
          if (error.code !== 'ENOENT') {
            console.error('[Datei] Gelöschter Nachrichtenanhang konnte nicht entfernt werden:', error.message);
          }
        });
      }
      realtime.emitConversation(message.conversation_id, 'message:deleted', {
        id: message.id,
        conversationId: message.conversation_id,
        scope: 'everyone'
      });
    } else {
      db.prepare(`
        INSERT INTO message_deletions (message_id, user_id) VALUES (?, ?)
        ON CONFLICT (message_id, user_id) DO NOTHING
      `).run(message.id, req.auth.sub);
    }
    res.status(204).end();
  });

  router.post('/conversations/:id/read', (req, res) => {
    if (!conversationAvailable(req.params.id, req.auth.sub)) {
      res.status(404).json({ error: 'Unterhaltung nicht gefunden.' });
      return;
    }
    const readAt = new Date().toISOString();
    const markRead = db.transaction(() => {
      db.prepare(`
        UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?
      `).run(readAt, req.params.id, req.auth.sub);
      db.prepare(`
        INSERT INTO message_reads (message_id, user_id, read_at)
        SELECT id, ?, ? FROM messages
        WHERE conversation_id = ? AND sender_id <> ? AND deleted_at IS NULL
        ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = excluded.read_at
      `).run(req.auth.sub, readAt, req.params.id, req.auth.sub);
    });
    markRead();
    realtime.emitConversation(req.params.id, 'conversation:read', {
      conversationId: req.params.id,
      userId: req.auth.sub,
      readAt
    });
    res.json({ readAt });
  });

  return router;
}

module.exports = { createChatRouter };
