// Kiểm thử đầu-cuối: giả lập Zalo (thay fetch) và Claude Code (test/fake-claude.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zbot-'));
process.env.PORT = String(18000 + Math.floor(Math.random() * 1000));
process.env.ZALO_BOT_TOKEN = '123:test';
process.env.ZALO_WEBHOOK_SECRET = 'secret-123';
process.env.ALLOWED_ZALO_IDS = 'owner1';
process.env.NOTIFY_SECRET = 'notify-secret';
process.env.VNC_URL = 'https://bot.example.com/vnc/';
process.env.CLAUDE_BIN = process.execPath;
process.env.CLAUDE_PRE_ARGS = new URL('./fake-claude.js', import.meta.url).pathname;
process.env.AGENT_WORKDIR = process.env.DATA_DIR;
process.env.FAKE_CLAUDE_LOG = path.join(process.env.DATA_DIR, 'fake-claude.log');
process.env.FAKE_CLAUDE_DELAY = '200';

const { createServer } = await import('../src/server.js');
const { jobToken } = await import('../src/notify.js');
const editTea = (await import('../src/workflows/edit-tea.js')).default;

const realFetch = globalThis.fetch;
const sent = [];
let base, server;

before(async () => {
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).startsWith('https://bot-api.zaloplatforms.com/')) {
      if (String(url).endsWith('/sendMessage')) sent.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }
    return realFetch(url, opts);
  };
  server = createServer().listen(Number(process.env.PORT));
  base = `http://127.0.0.1:${process.env.PORT}`;
});
after(() => server.close());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runs = () =>
  fs.existsSync(process.env.FAKE_CLAUDE_LOG)
    ? fs.readFileSync(process.env.FAKE_CLAUDE_LOG, 'utf8').trim().split('\n').map(JSON.parse)
    : [];
let mid = 0;
async function zalo(text, userId = 'owner1', secret = 'secret-123') {
  const res = await realFetch(`${base}/zalo/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({
      ok: true,
      result: {
        event_name: 'message.text.received',
        message: { from: { id: userId, display_name: 'Kiên' }, chat: { id: userId, chat_type: 'PRIVATE' }, text, message_id: 'm' + ++mid, date: Date.now() },
      },
    }),
  });
  await sleep(50);
  return res.status;
}
const lastText = () => sent.at(-1)?.text;
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await sleep(25);
  }
  throw new Error('timeout');
}

test('match lệnh edit trà', () => {
  assert.deepEqual(editTea.match('Edit cho a 10 video mới về trà'), { count: 10 });
  assert.deepEqual(editTea.match('dựng mười video chè'), { count: 10 });
  assert.deepEqual(editTea.match('edit video trà'), { count: 5 });
  assert.equal(editTea.match('trạng thái'), null);
  assert.equal(editTea.match('đăng 1 video lên fb'), null);
});

test('sai secret bị từ chối', async () => {
  assert.equal(await zalo('hướng dẫn', 'owner1', 'wrong'), 403);
});

test('người lạ không ra lệnh được, nhưng hỏi được id', async () => {
  await zalo('edit 10 video trà', 'stranger');
  assert.match(lastText(), /chưa có quyền/);
  await zalo('id', 'stranger');
  assert.match(lastText(), /stranger/);
  assert.equal(runs().length, 0);
});

test('hướng dẫn', async () => {
  await zalo('Hướng dẫn');
  assert.match(lastText(), /Bot Trợ lí ra lệnh/);
});

test('edit 10 video trà: chạy Claude trên VPS, chặn trùng, nhận báo kết quả', async () => {
  await zalo('Edit cho a 10 video mới về trà');
  assert.match(lastText(), /edit 10 video trà/);
  await until(() => runs().length === 1);
  const { args, payload } = runs()[0];
  assert.equal(payload.count, 10);
  assert.match(payload.notify_url, /^http:\/\/127\.0\.0\.1:\d+\/api\/notify$/);
  assert.equal(payload.vnc_url, 'https://bot.example.com/vnc/');
  assert.ok(args.includes('-p') && args.includes('mcp__browser'));

  await zalo('edit 5 video trà');
  assert.match(lastText(), /chưa xong/);

  await until(() => /✅ .*Chờ duyệt/.test(lastText() || ''));
  await zalo('trạng thái');
  assert.match(lastText(), /xong/);

  const r = await (await realFetch(`${base}/api/processed?job_id=${payload.job_id}&token=${payload.notify_token}`)).json();
  assert.ok(r.items.some((i) => i.filename === 'IMG_7097.MOV')); // từ seed
  assert.ok(r.items.some((i) => i.filename === 'IMG_9999.MOV' && i.job_id === payload.job_id));
});

test('token sai bị từ chối', async () => {
  const { payload } = runs()[0];
  const bad = await realFetch(`${base}/api/notify`, { method: 'POST', body: JSON.stringify({ job_id: payload.job_id, token: 'x', message: 'hi' }) });
  assert.equal(bad.status, 403);
  assert.equal((await realFetch(`${base}/api/processed?job_id=${payload.job_id}&token=bad`)).status, 403);
  assert.equal(jobToken(payload.job_id), payload.notify_token);
});

test('Claude thoát mà không báo cáo thì bot tự báo', async () => {
  process.env.FAKE_CLAUDE_MODE = 'silent';
  await zalo('edit 2 video trà');
  await until(() => /không gửi báo cáo/.test(lastText() || ''));
  delete process.env.FAKE_CLAUDE_MODE;
});

test('lệnh lạ', async () => {
  await zalo('nấu cơm');
  assert.match(lastText(), /chưa hiểu/);
});
