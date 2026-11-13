// Máy chủ HTTP:
//   POST /zalo/webhook  Zalo gửi tin nhắn tới (kiểm tra header X-Bot-Api-Secret-Token)
//   POST /api/notify    Phiên Claude báo tiến độ / kết quả: {job_id, token, status?, message, processed?}
//   GET  /api/processed Phiên Claude lấy danh sách đã làm (để bỏ qua)
//   GET  /health        Kiểm tra sống
import http from 'node:http';
import crypto from 'node:crypto';
import { config } from './config.js';
import { parseUpdate, sendMessage, sendTyping } from './zalo.js';
import { handleMessage } from './router.js';
import { getJob, updateJob } from './jobs.js';
import { listProcessed, addProcessed } from './processed.js';
import { checkJobToken } from './notify.js';
import { startScheduler } from './assistant/index.js';
import { getSetting, addMessage } from './assistant/store.js';
import { AGENT_TASK, takeInbox } from './assistant/tasks.js';

const seen = new Set(); // chống xử lý trùng khi Zalo gửi lại

function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function reply(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function onWebhook(req, res) {
  if (!config.zaloWebhookSecret || !safeEqual(req.headers['x-bot-api-secret-token'] || '', config.zaloWebhookSecret)) {
    return reply(res, 403, { message: 'forbidden' });
  }
  const payload = await readJson(req);
  reply(res, 200, { message: 'Success' }); // trả lời Zalo ngay, xử lý sau

  const msg = parseUpdate(payload);
  if (!msg || !msg.chatId) return;
  if (msg.messageId) {
    if (seen.has(msg.messageId)) return;
    seen.add(msg.messageId);
    if (seen.size > 1000) seen.delete(seen.values().next().value);
  }
  console.log(`[zalo] ${msg.name} (${msg.userId}): ${msg.text}`);
  sendTyping(msg.chatId);
  try {
    await handleMessage(msg, (text) => sendMessage(msg.chatId, text));
  } catch (e) {
    console.error('[zalo] handle failed', e);
    await sendMessage(msg.chatId, `Bot gặp lỗi: ${e.message}`).catch(() => {});
  }
}

async function onNotify(req, res) {
  const body = await readJson(req);
  const job = getJob(body.job_id);
  if (!job || !checkJobToken(body.job_id, body.token)) return reply(res, 403, { message: 'forbidden' });

  const ask = body.status === 'ask';
  const status = ['running', 'done', 'failed'].includes(body.status) ? body.status : ask ? 'running' : job.status;
  const message = String(body.message || '').slice(0, 4000);
  if (Array.isArray(body.processed) && body.processed.length) addProcessed(job.workflow, job.id, body.processed);
  updateJob(job.id, { status, ...(ask ? { waiting: message } : {}) }, message || `Trạng thái: ${status}`);
  // Anh Kiên chỉ muốn tin ngắn: nhận việc, cần anh làm gì, xong việc. Tin "running" chỉ ghi log, không nhắn Zalo.
  if (message && status !== 'running') {
    await sendMessage(job.chatId, status === 'failed' ? `❌ ${message}` : message);
  }
  if (message && ask) await sendMessage(job.chatId, message);
  // Kết quả việc thực thi đưa vào lịch sử để trợ lí biết khi anh hỏi tiếp.
  if (job.workflow === AGENT_TASK && message && (ask || status !== 'running')) {
    addMessage('assistant', `[Việc "${job.title}" ${ask ? 'hỏi anh' : status === 'done' ? 'đã xong' : 'bị lỗi'}] ${message}`);
  }
  reply(res, 200, { ok: true });
}

// Phiên Claude lấy danh sách video đã dựng để bỏ qua: GET /api/processed?job_id=..&token=..
// Việc thực thi đọc câu trả lời của anh: GET /api/inbox?job_id=..&token=..
function onInbox(url, res) {
  const jobId = url.searchParams.get('job_id');
  if (!getJob(jobId) || !checkJobToken(jobId, url.searchParams.get('token') || '')) return reply(res, 403, { message: 'forbidden' });
  reply(res, 200, { messages: takeInbox(jobId) });
}

function onProcessed(url, res) {
  const jobId = url.searchParams.get('job_id');
  const job = getJob(jobId);
  if (!job || !checkJobToken(jobId, url.searchParams.get('token') || '')) return reply(res, 403, { message: 'forbidden' });
  reply(res, 200, { items: listProcessed(job.workflow) });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'POST' && url.pathname === '/zalo/webhook') return await onWebhook(req, res);
      if (req.method === 'POST' && url.pathname === '/api/notify') return await onNotify(req, res);
      if (req.method === 'GET' && url.pathname === '/api/processed') return onProcessed(url, res);
      if (req.method === 'GET' && url.pathname === '/api/inbox') return onInbox(url, res);
      if (req.method === 'GET' && url.pathname === '/health') return reply(res, 200, { ok: true });
      reply(res, 404, { message: 'not found' });
    } catch (e) {
      console.error('[http]', e);
      if (!res.headersSent) reply(res, 400, { message: 'bad request' });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(config.port, config.host, () => console.log(`Bot dang chay o cong ${config.port}`));
  // Nhắc việc 7h, báo cáo tuần/tháng của Trợ lí 3 AI, gửi tới anh (người đầu tiên trong ALLOWED_ZALO_IDS).
  startScheduler(async (text) => {
    const chatId = getSetting('owner_chat_id') || config.allowedUsers[0];
    if (chatId) await sendMessage(chatId, text);
  });
}
