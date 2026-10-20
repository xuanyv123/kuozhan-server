/**
 * JWT 登录态：注册/登录成功后下发 token，App 保存在本地，
 * 之后每次请求带 Authorization: Bearer <token>，服务端据此识别用户。
 */
const jwt = require('jsonwebtoken');
const db = require('./db');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function signToken(user) {
  return jwt.sign({ uid: user.id }, SECRET, { expiresIn: '180d' });
}

/** 鉴权中间件：从请求头解析当前登录用户 */
function authRequired(req, res, next) {
  const head = req.headers.authorization || '';
  const token = head.startsWith('Bearer ') ? head.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    if (!user) return res.status(401).json({ error: '账号不存在' });
    req.user = user;
    req.userId = user.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

module.exports = { signToken, authRequired };
