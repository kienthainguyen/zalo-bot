// Kiểm thử đầu-cuối việc thực thi: anh nhắn Zalo -> trợ lí giao việc -> Claude Code (giả) hỏi anh -> anh trả lời -> xong.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zbot-task-'));
process.env.BATCH_WAIT_MS = '0';
process.env.AI_WORK_DIR = path.join(process.env.DATA_DIR, 'ai-work');
process.env.PORT = String(19000 + Math.floor(Math.random() * 1000));
process.env.ZALO_BOT_TOKEN = '123:test';
process.env.ZALO_WEBHOOK_SECRET = 'secret-123';
process.env.ALLOWED_ZALO_IDS = 'owner1';
process.env.NOTIFY_SECRET = 'notify-secret';
process.env.VNC_URL = 'https://bot.example.com/vnc/';
process.env.CLAUDE_BIN = process.execPath;
process.env.CLAUDE_PRE_ARGS = new URL('./fake-claude.js', import.meta.url).pathname;
process.env.AGENT_WORKDIR = process.env.DATA_DIR;
process.env.FAKE_CLAUDE_LOG = path.join(process.env.DATA_DIR, 'fake-claude.log');
process.env.ANTHROPIC_API_KEY = 'test-key';

const { createServer } = await import('../src/server.js');
const { ai } = await import('../src/assistant/ai.js');
const { getJob } = await import('../src/jobs.js');
const store = await import('../src/assistant/store.js');

const realFetch = globalThis.fetch;
const sent = [];
let base, server;
before(() => {
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).startsWith('https://bot-api.zaloplatforms.com/')) {
      if (String(url).endsWith('/sendMessage')) sent.push(JSON.parse(opts.body).text);
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }
    return realFetch(url, opts);
  };
  server = createServer().listen(Number(process.env.PORT));
  base = `http://127.0.0.1:${process.env.PORT}`;
});
after(() => server.close());

let script = [];
const calls = [];
ai.claude = async (p) => (calls.push(structuredClone(p)), script.shift()(p));
const text = (t) => () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const tool = (name, input) => () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu' + calls.length, name, input }] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await sleep(25);
  }
  throw new Error('timeout');
}
let mid = 0;
const zalo = (t) =>
  realFetch(`${base}/zalo/webhook`, {
    method: 'POST',
    headers: { 'X-Bot-Api-Secret-Token': 'secret-123' },
    body: JSON.stringify({
      result: { event_name: 'message.text.received', message: { from: { id: 'owner1', display_name: 'Kiên' }, chat: { id: 'owner1' }, text: t, message_id: 'm' + ++mid } },
    }),
  });

test('giao việc thực thi, hỏi anh khi cần đăng nhập, nhận câu trả lời, báo xong', async () => {
  const runs = () => (fs.existsSync(process.env.FAKE_CLAUDE_LOG) ? fs.readFileSync(process.env.FAKE_CLAUDE_LOG, 'utf8').trim().split('\n').map(JSON.parse) : []);
  script = [
    tool('start_task', { title: 'Tạo fanpage Trà Kiên Thái Nguyên', instructions: 'Tạo fanpage Facebook mới tên Trà Kiên Thái Nguyên, giới thiệu trà Thái Nguyên.' }),
    text('Em đã giao việc tạo fanpage, xong hoặc cần anh làm gì em sẽ báo ạ.'),
  ];
  await zalo('tạo cho anh 1 fanpage fb mới tên Trà Kiên Thái Nguyên');
  await until(() => sent.includes('Em đã giao việc tạo fanpage, xong hoặc cần anh làm gì em sẽ báo ạ.'));
  await until(() => runs().length === 1);
  const { args, payload } = runs()[0];
  assert.equal(payload.workflow, 'agent_task');
  assert.match(payload.task, /Trà Kiên Thái Nguyên/);
  assert.ok(args.includes('Bash') && args.includes('mcp__browser') && args.includes('WebSearch'));

  // Claude Code hỏi anh đăng nhập: tin hỏi lên Zalo, trợ lí thấy việc đang chờ.
  await until(() => sent.some((t) => /đăng nhập Facebook/.test(t)));
  assert.match(getJob(payload.job_id).waiting, /đăng nhập Facebook/);

  // Anh trả lời "xong": trợ lí thấy câu hỏi đang chờ trong bối cảnh và chuyển lời.
  script = [
    (p) => {
      assert.match(p.system[1].text, /đang chờ anh trả lời: Anh mở/);
      return tool('answer_task', { job_id: payload.job_id, message: 'xong' })();
    },
    text('Dạ em làm tiếp ạ.'),
  ];
  await zalo('xong rồi em');
  await until(() => sent.some((t) => /^Đã tạo fanpage/.test(t)));
  assert.equal(sent.at(-1), 'Đã tạo fanpage Trà Kiên Thái Nguyên (anh trả lời: xong).');
  assert.equal(getJob(payload.job_id).status, 'done');
  assert.ok(store.recentMessages(3).some((m) => /\[Việc "Tạo fanpage Trà Kiên Thái Nguyên" đã xong\]/.test(m.content)));

  // Inbox sai token bị từ chối.
  assert.equal((await realFetch(`${base}/api/inbox?job_id=${payload.job_id}&token=bad`)).status, 403);
});

test('anh bảo dừng: trợ lí gọi cancel_task, việc bị dừng', async () => {
  const runs = () => fs.readFileSync(process.env.FAKE_CLAUDE_LOG, 'utf8').trim().split('\n').map(JSON.parse);
  const before = runs().length;
  script = [tool('start_task', { title: 'Tạo kênh YouTube', instructions: 'Tạo kênh YouTube mới' }), text('Dạ em giao việc rồi ạ.')];
  await zalo('tạo kênh youtube mới cho anh');
  await until(() => runs().length === before + 1);
  const id = runs().at(-1).payload.job_id;
  await until(() => getJob(id).waiting);
  script = [tool('cancel_task', { job_id: id }), text('Dạ em dừng rồi ạ.')];
  await zalo('thôi dừng việc đó đi');
  await until(() => sent.includes('Dạ em dừng rồi ạ.'));
  assert.equal(getJob(id).status, 'cancelled');
  await sleep(300);
  assert.equal(getJob(id).status, 'cancelled', 'không bị ghi đè khi phiên Claude thoát');
});

test('trợ lí ra lệnh dựng video bằng lời tự nhiên (video_command)', async () => {
  const runs = () => fs.readFileSync(process.env.FAKE_CLAUDE_LOG, 'utf8').trim().split('\n').map(JSON.parse);
  const before = runs().length;
  script = [
    tool('video_command', { command: 'Edit cho a 2 video mới về trà' }),
    (p) => {
      assert.match(p.messages.at(-1).content[0].content, /^Bot trả lời: Em đã nhận việc dựng 2 video trà mới/);
      return text('Dạ em đã cho dựng 2 video trà ạ.')();
    },
  ];
  await zalo('tuần này anh cần thêm 2 clip chè mới để đăng nhé');
  await until(() => sent.includes('Dạ em đã cho dựng 2 video trà ạ.'));
  await until(() => runs().length === before + 1);
  assert.equal(runs().at(-1).payload.workflow, 'edit_tea');
});
