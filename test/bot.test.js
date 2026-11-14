// Kiểm thử đầu-cuối: giả lập Zalo (thay fetch) và Claude Code (test/fake-claude.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zbot-'));
process.env.BATCH_WAIT_MS = '0';
process.env.AI_WORK_DIR = path.join(process.env.DATA_DIR, 'ai-work');
process.env.PORT = String(18000 + Math.floor(Math.random() * 1000));
process.env.ZALO_BOT_TOKEN = '123:test';
process.env.ZALO_WEBHOOK_SECRET = 'secret-123';
process.env.ZALO_BOT2_TOKEN = '456:bot2';
process.env.ALLOWED_ZALO_IDS = 'owner1';
process.env.NOTIFY_SECRET = 'notify-secret';
process.env.VNC_URL = 'https://bot.example.com/vnc/';
process.env.CLAUDE_BIN = process.execPath;
process.env.CLAUDE_PRE_ARGS = new URL('./fake-claude.js', import.meta.url).pathname;
process.env.AGENT_WORKDIR = process.env.DATA_DIR;
process.env.FAKE_CLAUDE_LOG = path.join(process.env.DATA_DIR, 'fake-claude.log');
process.env.FAKE_CLAUDE_DELAY = '200';
process.env.ANTHROPIC_API_KEY = '';

const { createServer } = await import('../src/server.js');
const { jobToken } = await import('../src/notify.js');
const editTea = (await import('../src/workflows/edit-tea.js')).default;
const explainerMod = await import('../src/workflows/explainer.js');
const explainer = explainerMod.default;
const { checkDue } = await import('../src/watcher.js');
const { getJob } = await import('../src/jobs.js');
const FAR = () => Date.now() + 3600_000;
const { ai } = await import('../src/assistant/ai.js');
ai.claudeAgent = async () => 'Dạ trợ lí trả lời.';

const realFetch = globalThis.fetch;
const sent = [];
let base, server;

before(async () => {
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).startsWith('https://bot-api.zaloplatforms.com/')) {
      if (String(url).endsWith('/sendMessage')) sent.push({ ...JSON.parse(opts.body), bot: String(url).includes('/bot456:bot2/') ? 2 : 1 });
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
async function zalo(text, userId = 'owner1', secret = 'secret-123', bot = 1) {
  const res = await realFetch(`${base}/zalo/webhook${bot === 2 ? '?bot=2' : ''}`, {
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

test('match lệnh đồ họa giải thích', () => {
  assert.deepEqual(explainer.match('dựng cho a 3 video đồ họa giải thích về chủ đề "Ai chốt sale tự động"'), { count: 3, topic: 'Ai chốt sale tự động' });
  assert.deepEqual(explainer.match('Làm 2 video đồ hoạ giải thích về chủ đề AI chăm sóc khách hàng'), { count: 2, topic: 'AI chăm sóc khách hàng' });
  assert.deepEqual(explainer.match('tạo video đồ họa về “Trà shan tuyết là gì”'), { count: 3, topic: 'Trà shan tuyết là gì' });
  assert.equal(explainer.match('Edit cho a 10 video mới về trà'), null);
  // lệnh đồ họa về trà không được rơi vào luồng edit trà
  assert.equal(editTea.match('dựng 3 video đồ họa giải thích về "cách pha trà"'), null);
  assert.match(explainer.validate({ count: 3, topic: null }), /chủ đề/);
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
  assert.equal(lastText(), 'Em đã nhận việc dựng 10 video trà mới. Khi nào xong em sẽ báo lại anh vào duyệt.');
  await until(() => runs().length === 1);
  const { args, payload } = runs()[0];
  assert.equal(payload.count, 10);
  assert.match(payload.notify_url, /^http:\/\/127\.0\.0\.1:\d+\/api\/notify$/);
  assert.equal(payload.vnc_url, 'https://bot.example.com/vnc/');
  assert.ok(args.includes('-p') && args.includes('mcp__browser'));
  const mcp = args[args.indexOf('--mcp-config') + 1];
  assert.ok(path.isAbsolute(mcp) && fs.existsSync(mcp), `mcp-config phải là đường dẫn tuyệt đối có thật: ${mcp}`);

  await zalo('edit 5 video trà');
  assert.match(lastText(), /chưa xong/);

  // Claude bấm dựng xong thì thoát (Chrome rảnh), bot không nhắn gì thêm.
  await until(() => getJob(payload.job_id).status === 'rendering');
  assert.equal(getJob(payload.job_id).watch.length, 10);
  assert.match(lastText(), /chưa xong/);
  // Đang dựng trên app thì vẫn nhận lệnh dựng mới.
  checkDue(Date.now()); // chưa tới giờ kiểm tra
  await sleep(100);
  assert.equal(runs().length, 1);
  // Tới giờ: bot mở phiên kiểm tra ngắn, video đã vào Chờ duyệt thì báo anh.
  checkDue(FAR());
  await until(() => /Chờ duyệt/.test(lastText() || ''));
  const check = runs()[1].payload;
  assert.equal(check.job_id, payload.job_id);
  assert.equal(check.watch.length, 10);
  assert.equal(check.final, false);
  assert.equal(getJob(payload.job_id).status, 'done');
  assert.equal(lastText(), '10 video đã xong, hiện nằm trong phần Chờ duyệt, anh vào kiểm tra ạ.');
  assert.ok(!sent.some((m) => /chỉ ghi log/.test(m.text)), 'tin running không được gửi lên Zalo');
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
  await until(() => /chưa xác nhận được kết quả/.test(lastText() || ''));
  delete process.env.FAKE_CLAUDE_MODE;
});

test('đồ họa: chạy Claude với chủ đề và prompt riêng', async () => {
  const before = runs().length;
  await zalo('dựng cho a 3 video đồ họa giải thích về chủ đề "AI chốt sale tự động"');
  assert.equal(lastText(), 'Em đã nhận việc dựng 3 video đồ họa về "AI chốt sale tự động". Khi nào xong em sẽ báo lại anh vào duyệt.');
  await until(() => runs().length === before + 1);
  const { payload } = runs().at(-1);
  assert.equal(payload.workflow, 'explainer');
  assert.equal(payload.topic, 'AI chốt sale tự động');
  assert.equal(payload.count, 3);
  await until(() => getJob(payload.job_id).status === 'rendering');
  checkDue(FAR());
  await until(() => /^3 video đã xong/.test(lastText() || ''));
});

test('hướng dẫn liệt kê cả luồng đồ họa', async () => {
  await zalo('hướng dẫn');
  assert.match(lastText(), /đồ họa giải thích/);
});

test('tin thường chuyển cho Trợ lí 3 AI, không chạy nhầm luồng video', async () => {
  const before = runs().length;
  await zalo('nấu cơm');
  await until(() => lastText() === 'Dạ trợ lí trả lời.');
  sent.length = 0;
  await zalo('xong việc dựng video trà rồi');
  await until(() => lastText() === 'Dạ trợ lí trả lời.');
  assert.equal(runs().length, before, 'không được chạy luồng dựng video');
});

test('phiên kiểm tra thoát không báo gì: thử lại sau, không nhắn anh', async () => {
  await zalo('edit 1 video trà');
  await until(() => runs().at(-1)?.payload.count === 1);
  const id = runs().at(-1).payload.job_id;
  await until(() => getJob(id).status === 'rendering');
  const n = sent.length;
  process.env.FAKE_CLAUDE_MODE = 'silent';
  checkDue(FAR());
  await until(() => getJob(id).checkFailures === 1 && getJob(id).status === 'rendering');
  delete process.env.FAKE_CLAUDE_MODE;
  assert.equal(sent.length, n);
  assert.ok(getJob(id).nextCheckAt > Date.now());
});

test('đọc tin ảnh, sticker, không hỗ trợ từ webhook Zalo', async () => {
  const { parseUpdate } = await import('../src/zalo.js');
  const base = { from: { id: 'u', display_name: 'K' }, chat: { id: 'c' }, message_id: 'x' };
  assert.deepEqual(
    parseUpdate({ result: { event_name: 'message.image.received', message: { ...base, photo: 'https://p/1.jpg', caption: 'hoá đơn' } } }),
    { kind: 'image', chatId: 'c', userId: 'u', name: 'K', text: 'hoá đơn', photoUrl: 'https://p/1.jpg', messageId: 'x' },
  );
  assert.equal(parseUpdate({ result: { event_name: 'message.sticker.received', message: { ...base, sticker: 's1' } } }).kind, 'sticker');
  assert.equal(parseUpdate({ result: { event_name: 'message.unsupported.received', message: base } }).kind, 'unsupported');
  assert.equal(parseUpdate({ result: { event_name: 'message.location.received', message: base } }), null);
});

test('bot thứ 2 làm trợ lí y hệt, trả lời qua đúng bot', async () => {
  const before = sent.length;
  await zalo('hướng dẫn', 'owner1', 'secret-123', 2);
  await until(() => sent.length > before);
  assert.equal(sent.at(-1).bot, 2);
  assert.equal(sent.at(-1).chat_id, 'owner1');
  assert.match(sent.at(-1).text, /Trợ lí AI/);

  const n = sent.length;
  await zalo('Anh hỏi bot 2 một câu', 'owner1', 'secret-123', 2);
  await until(() => sent.length > n && sent.at(-1).text === 'Dạ trợ lí trả lời.');
  assert.equal(sent.at(-1).bot, 2);
  assert.equal(sent.at(-1).chat_id, 'owner1');

  // Bot 1 vẫn trả lời qua bot 1.
  const m = sent.length;
  await zalo('hướng dẫn');
  await until(() => sent.length > m);
  assert.equal(sent.at(-1).bot, 1);
  assert.equal(await zalo('hướng dẫn', 'owner1', 'sai', 2), 403);
});
