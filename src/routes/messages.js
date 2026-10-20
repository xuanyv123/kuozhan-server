/**
 * 消息系统：发送/获取 私聊&群聊消息，支持文字/图片/语音/闪图
 * 闪图：查看后自动焚毁（burned=1），服务端删除内容
 */
const express = require('express');
const db = require('../db');
const { authRequired: auth } = require('../auth');

const router = express.Router();

// 发送消息
router.post('/send', auth, (req, res) => {
  const { convType, toId, type, content, duration, voiceText } = req.body;
  if (!convType || !toId) return res.status(400).json({ error: '缺少会话信息' });
  if (type === undefined) return res.status(400).json({ error: '缺少消息类型' });

  // 权限校验
  if (convType === 1) {
    // 私聊：必须是好友
    const isFriend = db.prepare(
      "SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'accepted'"
    ).get(req.userId, toId);
    if (!isFriend) return res.status(403).json({ error: '请先加为好友' });
  } else if (convType === 2) {
    // 群聊：必须是群成员
    const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(toId, req.userId);
    if (!isMember) return res.status(403).json({ error: '不是群成员' });
  } else {
    return res.status(400).json({ error: '无效会话类型' });
  }

  const now = Date.now();
  const msg = db.prepare(
    'INSERT INTO messages (conv_type, from_id, to_id, type, content, duration, voice_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(convType, req.userId, toId, type, content || '', duration || 0, voiceText || '', now);

  res.json({
    id: msg.lastInsertRowid,
    conv_type: convType,
    from_id: req.userId,
    to_id: toId,
    type,
    content: content || '',
    duration: duration || 0,
    voice_text: voiceText || '',
    burned: 0,
    created_at: now
  });
});

// 获取消息列表（分页）
router.get('/list', auth, (req, res) => {
  const convType = parseInt(req.query.convType);
  const toId = parseInt(req.query.toId);
  const before = parseInt(req.query.before || '0');
  const limit = Math.min(parseInt(req.query.limit || '50'), 100);

  if (!convType || !toId) return res.status(400).json({ error: '缺少会话信息' });

  // 权限校验
  if (convType === 1) {
    const isFriend = db.prepare(
      "SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'accepted'"
    ).get(req.userId, toId);
    if (!isFriend) return res.status(403).json({ error: '请先加为好友' });
  } else if (convType === 2) {
    const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(toId, req.userId);
    if (!isMember) return res.status(403).json({ error: '不是群成员' });
  }

  let messages;
  if (before > 0) {
    messages = db.prepare(`
      SELECT m.*, u.nickname as from_nickname, u.avatar_url as from_avatar, u.auth_type
      FROM messages m
      JOIN users u ON u.id = m.from_id
      WHERE m.conv_type = ? AND m.to_id = ? AND m.id < ?
      ORDER BY m.id DESC
      LIMIT ?
    `).all(convType, toId, before, limit);
  } else {
    messages = db.prepare(`
      SELECT m.*, u.nickname as from_nickname, u.avatar_url as from_avatar, u.auth_type
      FROM messages m
      JOIN users u ON u.id = m.from_id
      WHERE m.conv_type = ? AND m.to_id = ?
      ORDER BY m.id DESC
      LIMIT ?
    `).all(convType, toId, limit);
  }

  // 闪图处理：已焚毁的不返回内容；未焚毁且是接收方，标记可查看
  const result = messages.map(m => {
    if (m.type === 3 && m.burned === 1) {
      return { ...m, content: '', burned: 1, flash_viewed: true };
    }
    if (m.type === 3 && m.from_id !== req.userId) {
      return { ...m, flash_can_view: true };
    }
    return m;
  }).reverse();

  res.json({ messages: result });
});

// 查看闪图（阅后即焚）
router.post('/flash/view', auth, (req, res) => {
  const { messageId } = req.body;
  if (!messageId) return res.status(400).json({ error: '缺少消息ID' });

  const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND type = 3').get(messageId);
  if (!msg) return res.status(404).json({ error: '闪图不存在' });
  if (msg.from_id === req.userId) return res.status(400).json({ error: '不能查看自己发的闪图' });
  if (msg.burned === 1) return res.status(410).json({ error: '闪图已焚毁' });

  // 权限：私聊必须是好友，群聊必须是群成员
  if (msg.conv_type === 1) {
    const isFriend = db.prepare(
      "SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'accepted'"
    ).get(req.userId, msg.from_id);
    if (!isFriend) return res.status(403).json({ error: '请先加为好友' });
  } else if (msg.conv_type === 2) {
    const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(msg.to_id, req.userId);
    if (!isMember) return res.status(403).json({ error: '不是群成员' });
  }

  // 返回图片内容，然后焚毁
  const content = msg.content;
  db.prepare('UPDATE messages SET burned = 1, content = ? WHERE id = ?').run('', messageId);

  res.json({ content, burned: true });
});

// 会话列表（私聊+群聊合并）
router.get('/conversations', auth, (req, res) => {
  // 私聊会话：基于好友关系 + 最后一条消息
  const privateConvs = db.prepare(`
    SELECT 
      1 as conv_type,
      f.friend_id as id,
      u.nickname,
      u.avatar_url,
      u.auth_type,
      (SELECT content FROM messages WHERE conv_type = 1 AND ((from_id = ? AND to_id = f.friend_id) OR (from_id = f.friend_id AND to_id = ?)) ORDER BY id DESC LIMIT 1) as last_msg,
      (SELECT type FROM messages WHERE conv_type = 1 AND ((from_id = ? AND to_id = f.friend_id) OR (from_id = f.friend_id AND to_id = ?)) ORDER BY id DESC LIMIT 1) as last_type,
      (SELECT created_at FROM messages WHERE conv_type = 1 AND ((from_id = ? AND to_id = f.friend_id) OR (from_id = f.friend_id AND to_id = ?)) ORDER BY id DESC LIMIT 1) as last_time
    FROM friends f
    JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ? AND f.status = 'accepted'
  `).all(req.userId, req.userId, req.userId, req.userId, req.userId, req.userId, req.userId);

  // 群聊会话
  const groupConvs = db.prepare(`
    SELECT
      2 as conv_type,
      g.id,
      g.name,
      g.avatar_url,
      0 as auth_type,
      (SELECT content FROM messages WHERE conv_type = 2 AND to_id = g.id ORDER BY id DESC LIMIT 1) as last_msg,
      (SELECT type FROM messages WHERE conv_type = 2 AND to_id = g.id ORDER BY id DESC LIMIT 1) as last_type,
      (SELECT created_at FROM messages WHERE conv_type = 2 AND to_id = g.id ORDER BY id DESC LIMIT 1) as last_time
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ?
  `).all(req.userId);

  const all = [...privateConvs, ...groupConvs].sort((a, b) => (b.last_time || 0) - (a.last_time || 0));
  res.json({ conversations: all });
});

module.exports = router;
