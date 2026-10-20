/**
 * 文件上传：图片、语音（multer 处理 multipart/form-data）
 * 上传后返回可访问的 URL
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authRequired: auth } = require('../auth');

const router = express.Router();

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp3', '.m4a', '.aac', '.ogg', '.wav'].includes(ext) ? ext : '.bin';
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// 上传单文件
router.post('/file', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '没有文件' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url, filename: req.file.filename, size: req.file.size });
});

// 上传多文件（最多9张）
router.post('/files', auth, upload.array('files', 9), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: '没有文件' });
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ urls });
});

module.exports = router;
