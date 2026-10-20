/**
 * 扩列 App 后端入口。
 * 运行：npm install 后 npm start（部署 Render 时自动执行）
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');

const { router: authRouter } = require('./routes/auth');
const usersRouter = require('./routes/users');
const friendsRouter = require('./routes/friends');
const groupsRouter = require('./routes/groups');
const messagesRouter = require('./routes/messages');
const uploadRouter = require('./routes/upload');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// 静态文件：上传的图片/头像/语音
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// 全局限流：每个 IP 每分钟最多 120 次请求
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
}));

// 验证码接口单独限流：每 10 分钟最多 5 次
app.use('/api/auth/send-code', rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: '验证码请求过于频繁，请 10 分钟后再试' }
}));

app.get('/', (req, res) => res.json({ name: '扩列后端', status: 'running' }));

app.use('/api/auth', authRouter);
app.use('/api', usersRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/upload', uploadRouter);

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('server error:', err);
  if (err instanceof multer.MulterError || err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: '文件过大（最大 15MB）' });
  }
  res.status(500).json({ error: '服务器开小差了' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`扩列后端已启动: http://localhost:${PORT}`);
});
