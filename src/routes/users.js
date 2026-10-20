/**
 * 用户资料、隐私设置、定位上报、附近的人。
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { authRequired } = require('../auth');
const { publicUser } = require('./auth');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, 'u' + req.user.id + '_' + Date.now() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB（头像/图片）
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('只支持图片文件'));
  }
});

/** 我的资料 */
router.get('/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/** 编辑资料 */
const EDITABLE = ['nickname', 'signature', 'species', 'hobby', 'region', 'gender'];
router.put('/me/profile', authRequired, (req, res) => {
  const body = req.body || {};
  const fields = [];
  const values = [];

  for (const key of EDITABLE) {
    if (body[key] !== undefined) {
      let v = body[key];
      if (key === 'gender') v = [0, 1, 2].includes(Number(v)) ? Number(v) : 0;
      else v = String(v).slice(0, 100);
      fields.push(key === 'nickname' ? 'nickname = ?' : `${key} = ?`);
      values.push(v);
    }
  }
  if (fields.length === 0) return res.json({ user: publicUser(req.user) });

  fields.push('updated_at = ?');
  values.push(Date.now(), req.user.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

/** 隐私开关：是否允许雷达搜索 / 是否共享位置 */
router.put('/me/privacy', authRequired, (req, res) => {
  const { allowRadarSearch, shareLocation } = req.body || {};
  db.prepare(
    `UPDATE users SET
       allow_radar_search = ?,
       share_location = ?,
       updated_at = ?
     WHERE id = ?`
  ).run(
    allowRadarSearch ? 1 : 0,
    shareLocation ? 1 : 0,
    Date.now(),
    req.user.id
  );
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

/** 上报定位（App 每次定位变化时调用） */
router.post('/me/location', authRequired, (req, res) => {
  const lat = Number(req.body.lat);
  const lon = Number(req.body.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon) || lat === 0 || lon === 0) {
    return res.status(400).json({ error: '定位数据无效' });
  }
  db.prepare(
    'UPDATE users SET lat = ?, lon = ?, location_updated_at = ?, updated_at = ? WHERE id = ?'
  ).run(lat, lon, Date.now(), Date.now(), req.user.id);
  res.json({ ok: true });
});

/** 头像上传（multipart/form-data 字段名 avatar） */
router.post('/me/avatar', authRequired, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到图片' });
  const url = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?')
    .run(url, Date.now(), req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user), avatarUrl: url });
});

/** Haversine 距离（米） */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** 附近的人（只返回：共享位置 + 允许雷达搜索 + 定位在 30 分钟内） */
router.get('/nearby', authRequired, (req, res) => {
  const lat = Number(req.query.lat ?? req.user.lat);
  const lon = Number(req.query.lon ?? req.user.lon);
  const radius = Math.min(Number(req.query.radius) || 50000, 500000); // 最远 500km
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: '缺少定位参数' });
  }
  const fresh = Date.now() - 30 * 60 * 1000;
  const rows = db.prepare(
    `SELECT * FROM users
     WHERE id != ? AND share_location = 1 AND allow_radar_search = 1
       AND lat IS NOT NULL AND lon IS NOT NULL
       AND location_updated_at > ?`
  ).all(req.user.id, fresh);

  const list = rows
    .map((u) => {
      const d = distanceMeters(lat, lon, u.lat, u.lon);
      return { ...publicUser(u), distanceMeters: d };
    })
    .filter((u) => u.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 100);

  res.json({ users: list });
});

/** 搜索用户：按扩列号 / 昵称 / 物种 / 地区 / 爱好 模糊匹配 */
router.get('/users/search', authRequired, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ users: [] });
  const like = `%${q}%`;
  const rows = db.prepare(
    `SELECT * FROM users
     WHERE id != ? AND (
       custom_id LIKE ? OR nickname LIKE ? OR species LIKE ?
       OR region LIKE ? OR hobby LIKE ?
     )
     ORDER BY (allow_radar_search = 1) DESC
     LIMIT 50`
  ).all(req.user.id, like, like, like, like, like);

  const me = req.user;
  res.json({
    users: rows.map((u) => {
      const d = (me.lat != null && u.lat != null)
        ? distanceMeters(me.lat, me.lon, u.lat, u.lon) : null;
      return { ...publicUser(u), distanceMeters: d };
    })
  });
});

/** 查看他人主页 */
router.get('/users/:id', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const data = publicUser(u);
  // 陌生人不返回精确坐标
  data.lat = data.lon = undefined;
  const me = req.user;
  if (me.lat != null && u.lat != null) {
    data.distanceMeters = distanceMeters(me.lat, me.lon, u.lat, u.lon);
  }
  res.json({ user: data });
});

module.exports = router;
