/**
 * 数据库层：SQLite（一个文件就是整个数据库，零成本、易部署）。
 * 后续要换成云数据库（Turso / PostgreSQL）只需改这一层。
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ---------------- 建表 ----------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  email               TEXT UNIQUE,
  phone               TEXT UNIQUE,
  password_hash       TEXT,
  nickname            TEXT NOT NULL,
  custom_id           TEXT UNIQUE,            -- 用户自定义唯一ID（扩列号）
  avatar_url          TEXT,
  signature           TEXT DEFAULT '',
  species             TEXT DEFAULT '',
  hobby               TEXT DEFAULT '',
  region              TEXT DEFAULT '',
  gender              INTEGER DEFAULT 0,      -- 0未知 1男 2女
  auth_type           INTEGER DEFAULT 0,      -- 0普通 1官方认证 2主播认证
  allow_radar_search  INTEGER DEFAULT 1,      -- 是否允许被雷达搜到
  share_location      INTEGER DEFAULT 1,      -- 是否共享位置
  lat                 REAL,
  lon                 REAL,
  location_updated_at INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  code        TEXT NOT NULL,
  purpose     TEXT NOT NULL,                  -- register | login | reset
  used        INTEGER DEFAULT 0,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email);

-- 后续批次会用到的表，先建好，避免以后改动
CREATE TABLE IF NOT EXISTS friends (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  friend_id   INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | blocked
  message     TEXT DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id);

CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  owner_id    INTEGER NOT NULL,
  avatar_url  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  role        INTEGER DEFAULT 0,              -- 0成员 1群主
  joined_at   INTEGER NOT NULL,
  UNIQUE(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_type   INTEGER NOT NULL,               -- 1私聊 2群聊
  from_id     INTEGER NOT NULL,
  to_id       INTEGER NOT NULL,               -- 私聊:对方用户id  群聊:群组id
  type        INTEGER NOT NULL DEFAULT 0,     -- 0文字 1图片 2语音 3闪图
  content     TEXT,                           -- 文字内容/媒体URL
  duration    REAL DEFAULT 0,                 -- 语音时长(秒)
  voice_text  TEXT,                           -- 语音转文字结果
  burned      INTEGER DEFAULT 0,              -- 闪图是否已焚毁
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_type, to_id, id);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  text        TEXT,
  media_urls  TEXT,                           -- JSON数组
  region      TEXT,
  created_at  INTEGER NOT NULL
);
`);

module.exports = db;
