/**
 * 群聊：创建群聊（选择好友）、群聊列表、群成员、群信息
 */
const express = require('express');
const db = require('../db');
const { authRequired: auth } = require('../auth');

const router = express.Router();

// 创建群聊
router.post('/create', auth, (req, res) => {
  const { name, memberIds } = req.body;
  if (!name || !memberIds || !Array.isArray(memberIds) || memberIds.length < 1) {
    return res.status(400).json({ error: '群名和至少1个好友必填' });
  }
  if (memberIds.length > 99) return res.status(400).json({ error: '群成员最多100人' });

  const now = Date.now();
  const tx = db.transaction(() => {
    const group = db.prepare(
      'INSERT INTO groups (name, owner_id, created_at) VALUES (?, ?, ?)'
    ).run(name, req.userId, now);
    const groupId = group.lastInsertRowid;
    // 群主加入
    db.prepare(
      'INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 1, ?)'
    ).run(groupId, req.userId, now);
    // 成员加入（必须是好友）
    const insertMember = db.prepare(
      'INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 0, ?)'
    );
    for (const mid of memberIds) {
      const isFriend = db.prepare(
        "SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'accepted'"
      ).get(req.userId, mid);
      if (isFriend) insertMember.run(groupId, mid, now);
    }
    return groupId;
  });
  const groupId = tx();
  res.json({ groupId });
});

// 我的群聊列表
router.get('/list', auth, (req, res) => {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.avatar_url, g.owner_id,
           (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
           (SELECT content FROM messages WHERE conv_type = 2 AND to_id = g.id ORDER BY id DESC LIMIT 1) as last_msg,
           (SELECT created_at FROM messages WHERE conv_type = 2 AND to_id = g.id ORDER BY id DESC LIMIT 1) as last_time
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ?
    ORDER BY COALESCE(last_time, g.created_at) DESC
  `).all(req.userId);
  res.json({ groups });
});

// 群成员列表
router.get('/:id/members', auth, (req, res) => {
  const groupId = req.params.id;
  const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, req.userId);
  if (!isMember) return res.status(403).json({ error: '不是群成员' });

  const members = db.prepare(`
    SELECT u.id, u.nickname, u.avatar_url, u.auth_type, gm.role
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
    ORDER BY gm.role DESC, u.nickname
  `).all(groupId);
  res.json({ members });
});

// 群信息
router.get('/:id', auth, (req, res) => {
  const groupId = req.params.id;
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group) return res.status(404).json({ error: '群不存在' });
  const memberCount = db.prepare('SELECT COUNT(*) as c FROM group_members WHERE group_id = ?').get(groupId).c;
  res.json({ ...group, member_count: memberCount });
});

// 退出群聊
router.post('/:id/leave', auth, (req, res) => {
  const groupId = req.params.id;
  const group = db.prepare('SELECT owner_id FROM groups WHERE id = ?').get(groupId);
  if (!group) return res.status(404).json({ error: '群不存在' });
  if (group.owner_id === req.userId) return res.status(400).json({ error: '群主不能退出，请先转让或解散' });
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, req.userId);
  res.json({ ok: true });
});

module.exports = router;
