/**
 * 认证路由：邮箱验证码（真实邮件）、注册、登录。
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken } = require('../auth');
const { sendCodeEmail } = require('../mailer');

const router = express.Router();

const now = () => Date.now();
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const CODE_TTL = 10 * 60 * 1000;      // 验证码 10 分钟
const RESEND_GAP = 60 * 1000;         // 两次发送间隔 60 秒

const PURPOSE_LABEL = {
  register: '注册',
  login: '登录',
  reset: '找回密码'
};

function gen6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function genCustomId() {
  // 扩列号：K + 8 位数字，保证唯一
  for (let i = 0; i < 20; i++) {
    const id = 'K' + String(Math.floor(10000000 + Math.random() * 90000000));
    const exists = db.prepare('SELECT 1 FROM users WHERE custom_id = ?').get(id);
    if (!exists) return id;
  }
  return 'K' + Date.now().toString().slice(-8);
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    nickname: u.nickname,
    customId: u.custom_id,
    avatarUrl: u.avatar_url,
    signature: u.signature,
    species: u.species,
    hobby: u.hobby,
    region: u.region,
    gender: u.gender,
    authType: u.auth_type,
    allowRadarSearch: !!u.allow_radar_search,
    shareLocation: !!u.share_location,
    lat: u.lat,
    lon: u.lon,
    createdAt: u.created_at
  };
}

/** 1. 发送邮箱验证码 */
router.post('/send-code', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const purpose = ['register', 'login', 'reset'].includes(req.body.purpose)
      ? req.body.purpose : 'register';

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }

    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (purpose === 'register' && existing) {
      return res.status(400).json({ error: '该邮箱已注册，直接登录即可' });
    }
    if ((purpose === 'login' || purpose === 'reset') && !existing) {
      return res.status(400).json({ error: '该邮箱尚未注册' });
    }

    // 60 秒防重发
    const last = db.prepare(
      'SELECT created_at FROM email_codes WHERE email = ? ORDER BY id DESC LIMIT 1'
    ).get(email);
    if (last && now() - last.created_at < RESEND_GAP) {
      const wait = Math.ceil((RESEND_GAP - (now() - last.created_at)) / 1000);
      return res.status(429).json({ error: `发送太频繁，请 ${wait} 秒后再试` });
    }

    const code = gen6();
    db.prepare(
      `INSERT INTO email_codes (email, code, purpose, used, expires_at, created_at)
       VALUES (?, ?, ?, 0, ?, ?)`
    ).run(email, code, purpose, now() + CODE_TTL, now());

    // 开发自测开关：未配置 SMTP 且显式设置 ALLOW_DEV_CODE=true 时，
    // 直接返回验证码（仅用于本地/测试，生产环境切勿开启）
    if (process.env.ALLOW_DEV_CODE === 'true') {
      let t;
      try { t = require('../mailer').getTransporter(); } catch (_) { t = null; }
      if (!t) {
        console.log(`[DEV] 邮箱 ${email} 的验证码：${code}`);
        return res.json({
          ok: true,
          message: '【开发模式】SMTP 未配置，验证码已直接返回',
          devCode: code
        });
      }
    }

    await sendCodeEmail(email, code, PURPOSE_LABEL[purpose]);

    // 安全提示：不泄露验证码。仅在未配置 SMTP 时明确报错
    res.json({ ok: true, message: '验证码已发送，请查收邮箱（含垃圾邮件）' });
  } catch (e) {
    if (e.code === 'SMTP_NOT_CONFIGURED') {
      return res.status(500).json({
        error: '服务端尚未配置发信邮箱（SMTP），请按教程填写 SMTP_USER / SMTP_PASS 后再试'
      });
    }
    console.error('send-code error:', e);
    res.status(500).json({ error: '邮件发送失败，请稍后重试' });
  }
});

/** 校验并消费验证码 */
function verifyCode(email, code, purpose) {
  const row = db.prepare(
    `SELECT * FROM email_codes
     WHERE email = ? AND purpose = ? AND used = 0
     ORDER BY id DESC LIMIT 1`
  ).get(email, purpose);
  if (!row) return { ok: false, error: '请先获取验证码' };
  if (row.expires_at < now()) return { ok: false, error: '验证码已过期，请重新获取' };
  if (row.code !== String(code)) return { ok: false, error: '验证码不正确' };
  db.prepare('UPDATE email_codes SET used = 1 WHERE id = ?').run(row.id);
  return { ok: true };
}

/** 2. 邮箱验证码注册 */
router.post('/register', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  const password = String(req.body.password || '');
  let nickname = String(req.body.nickname || '').trim();

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: '请输入 6 位验证码' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(400).json({ error: '该邮箱已注册' });
  }
  if (!nickname) nickname = '扩列用户' + Math.floor(1000 + Math.random() * 9000);
  if (nickname.length > 20) nickname = nickname.slice(0, 20);

  const check = verifyCode(email, code, 'register');
  if (!check.ok) return res.status(400).json({ error: check.error });

  const hash = bcrypt.hashSync(password, 10);
  const t = now();
  const info = db.prepare(
    `INSERT INTO users
       (email, password_hash, nickname, custom_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(email, hash, nickname, genCustomId(), t, t);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ token: signToken(user), user: publicUser(user) });
});

/** 3. 邮箱验证码登录（无需密码） */
router.post('/login-code', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: '请输入 6 位验证码' });

  const check = verifyCode(email, code, 'login');
  if (!check.ok) return res.status(400).json({ error: check.error });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(400).json({ error: '账号不存在，请先注册' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

/** 4. 邮箱 + 密码登录 */
router.post('/login-password', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: '邮箱格式不正确' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(400).json({ error: '邮箱或密码不正确' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

module.exports = { router, publicUser };
