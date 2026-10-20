/**
 * 邮件发送：通过 QQ/163 邮箱 SMTP 发送真实验证码邮件。
 * 不额外花钱，国内邮箱（QQ/163/126/Outlook/Gmail）都能收到。
 */
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass || user.includes('你的')) {
    return null; // 还没配置 SMTP，调用方会给用户友好提示
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.qq.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: { user, pass }
  });
  return transporter;
}

function codeEmailHtml(code, purposeLabel) {
  return `
  <div style="background:#0a1122;padding:32px 16px;font-family:'PingFang SC','Microsoft YaHei',sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#101c36;border:1px solid #1c3052;border-radius:16px;padding:32px;">
      <div style="font-size:22px;font-weight:bold;color:#39e6ff;letter-spacing:2px;">扩 列</div>
      <p style="color:#cfd9ea;font-size:15px;margin-top:24px;">你好，你正在进行【${purposeLabel}】操作，验证码为：</p>
      <div style="text-align:center;margin:28px 0;">
        <span style="font-size:38px;font-weight:bold;color:#7c6bff;letter-spacing:10px;">${code}</span>
      </div>
      <p style="color:#8a97b0;font-size:13px;">验证码 10 分钟内有效，请勿泄露给他人。如果不是你本人操作，请忽略这封邮件。</p>
    </div>
  </div>`;
}

async function sendCodeEmail(to, code, purposeLabel) {
  const t = getTransporter();
  if (!t) {
    const err = new Error('SMTP_NOT_CONFIGURED');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  await t.sendMail({
    from: `"${process.env.MAIL_FROM_NAME || '扩列'}" <${process.env.SMTP_USER}>`,
    to,
    subject: `【扩列】${purposeLabel}验证码 ${code}`,
    html: codeEmailHtml(code, purposeLabel)
  });
}

module.exports = { sendCodeEmail, getTransporter };
