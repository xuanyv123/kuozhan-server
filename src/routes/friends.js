/**
 * 好友系统：发送申请、接受/拒绝、好友列表、删除好友
 */
const express = require('express');
const db = require('../db');
const { authRequired: auth } = require('../auth');

const router = express.Router();

// 发送好友申请
router.post('/request', auth, (req, res) => {
  const { targetId, message } = req.body;
  if (!targetId) return res.status(400).json({ error: '缺少目标用户' });
  if (targetId === req.userId) return res.status(400).json({ error: '不能加自己' });

  const target = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: '用户不存在' });

  const now = Date.now();
  // 检查是否已是好友
  const exist = db.prepare(
    "SELECT * FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'accepted'"
  ).get(req.userId, targetId);
  if (exist) return res.status(400).json({ error: '已经是好友了' });

  // 检查是否已有待处理申请（对方发给我或我发给对方）
  const pending = db.prepare(
    "SELECT * FROM friends WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = 'pending'"
  ).get(req.userId, targetId, targetId, req.userId);
  if (pending) return res.status(400).json({ error: '已有待处理的申请' });

  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO friends (user_id, friend_id, status, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.userId, targetId, 'pending', message || '', now, now);
  });
  tx();
  res.json({ ok: true });
});

// 接受/拒绝好友申请
router.post('/respond', auth, (req, res) => {
  const { requestId, accept } = req.body;
  if (!requestId) return res.status(400).json({ error: '缺少申请ID' });

  const reqRow = db.prepare(
    "SELECT * FROM friends WHERE id = ? AND friend_id = ? AND status = 'pending'"
  ).get(requestId, req.userId);
  if (!reqRow) return res.status(404).json({ error: '申请不存在' });

  const now = Date.now();
  if (accept) {
    const tx = db.transaction(() => {
      // 接受：双向建立好友关系
      db.prepare("UPDATE friends SET status = 'accepted', updated_at = ? WHERE id = ?").run(now, requestId);
      // 反向记录
      const reverse = db.prepare(
        'INSERT OR IGNORE INTO friends (user_id, friend_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(req.userId, reqRow.user_id, 'accepted', now, now);
    });
    tx();
    res.json({ ok: true });
  } else {
    db.prepare("DELETE FROM friends WHERE id = ?").run(requestId);
    res.json({ ok: true });
  }
});

// 好友列表
router.get('/list', auth, (req, res) => {
  const friends = db.prepare(`
    SELECT u.id, u.nickname, u.avatar_url, u.signature, u.auth_type
    FROM friends f
    JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ? AND f.status = 'accepted'
    ORDER BY u.nickname
  `).all(req.userId);
  res.json({ friends });
});

// 收到的好友申请列表
router.get('/requests', auth, (req, res) => {
  const requests = db.prepare(`
    SELECT f.id, f.message, f.created_at,
           u.id as user_id, u.nickname, u.avatar_url, u.auth_type
    FROM friends f
    JOIN users u ON u.id = f.user_id
    WHERE f.friend_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `).all(req.userId);
  res.json({ requests });
});

// 删除好友
router.post('/delete', auth, (req, res) => {
  const { friendId } = req.body;
  if (!friendId) return res.status(400).json({ error: '缺少好友ID' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(req.userId, friendId);
    db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(friendId, req.userId);
  });
  tx();
  res.json({ ok: true });
});

module.exports = router;
