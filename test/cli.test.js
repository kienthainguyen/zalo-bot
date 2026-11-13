// Kiểm thử trợ lí dùng gói đăng ký: Claude Code, Codex, Gemini CLI (giả lập bằng test/fake-ai-cli.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fake = new URL('./fake-ai-cli.js', import.meta.url).pathname;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zbot-cli-'));
process.env.BATCH_WAIT_MS = '0';
process.env.PORT = String(20000 + Math.floor(Math.random() * 1000));
process.env.ALLOWED_ZALO_IDS = 'owner1';
process.env.NOTIFY_SECRET = 'notify-secret';
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'CLAUDE_MODEL', 'OPENAI_MODEL', 'GEMINI_MODEL']) delete process.env[k];
process.env.CLAUDE_BIN = process.execPath;
process.env.CLAUDE_PRE_ARGS = fake;
process.env.CODEX_BIN = process.execPath;
process.env.CODEX_PRE_ARGS = fake;
process.env.GEMINI_BIN = process.execPath;
process.env.GEMINI_PRE_ARGS = fake;
process.env.GEMINI_CLI = '1';
process.env.FAKE_AI_LOG = path.join(process.env.DATA_DIR, 'ai.log');
process.env.AI_WORK_DIR = path.join(process.env.DATA_DIR, 'ai-work');

const { createServer } = await import('../src/server.js');
const { handleMessage: route } = await import('../src/router.js');
const store = await import('../src/assistant/store.js');
let server;
before(() => (server = createServer().listen(Number(process.env.PORT))));
after(() => server.close());

const calls = () => fs.readFileSync(process.env.FAKE_AI_LOG, 'utf8').trim().split('\n').map(JSON.parse);
const sent = [];
const say = (t) => route({ chatId: 'c1', userId: 'owner1', text: t }, async (x) => sent.push(x));

test('tin thường: Claude Code (gói Max) gọi công cụ qua curl về bot', async () => {
  await say('mai gọi khách A');
  assert.match(sent.at(-1), /^Dạ em đã ghi \(Đã tạo: #\d+ Gọi khách A \[sắp làm, hạn 2026-11-14\]\)$/);
  assert.ok(store.listTasks('open').some((t) => t.title === 'Gọi khách A'));
  const c = calls()[0];
  assert.equal(c.kind, 'claude');
  assert.ok(c.argv.includes('-p') && c.argv.includes('--allowedTools') && c.argv.some((a) => /^Bash\(curl -sS -X POST http:\/\/127\.0\.0\.1:\d+\/api\/assistant\/tool:\*\)$/.test(a)) && c.argv.includes('Read(./inbox/**)'));
  assert.ok(!c.argv.includes('--model'), 'không ép model khi chưa đặt CLAUDE_MODEL');
  assert.match(c.input, /Anh: mai gọi khách A/);
});

test('việc quan trọng: Codex (ChatGPT Plus) phản biện, Gemini CLI trọng tài, Claude sửa', async () => {
  process.env.FAKE_GPT = '- Thiếu ngân sách';
  const n = calls().length;
  await say('lập kế hoạch mở chi nhánh');
  assert.match(sent.at(-1), /^Bản sửa có ngân sách\n\n— Claude soạn, GPT phản biện, Gemini yêu cầu chỉnh sửa: Thiếu ngân sách\.$/);
  const kinds = calls().slice(n).map((c) => c.kind);
  assert.deepEqual(kinds, ['claude', 'codex', 'gemini', 'claude']);
  const codex = calls()[n + 1];
  assert.ok(codex.argv.includes('read-only') && codex.argv.includes('--skip-git-repo-check'));
  const gemini = calls()[n + 2];
  assert.ok(gemini.argv.includes('plan'));
  assert.match(gemini.input, /PHẢN BIỆN CỦA GPT:\n- Thiếu ngân sách/);
});

test('công cụ: phiên/token sai bị từ chối', async () => {
  const r = await fetch(`http://127.0.0.1:${process.env.PORT}/api/assistant/tool`, {
    method: 'POST',
    body: JSON.stringify({ session: 'x', token: 'y', name: 'add_task', input: { title: 'hack' } }),
  });
  assert.equal(r.status, 403);
});

test('mặc định không có Gemini: Claude tự cân nhắc phản biện của GPT', async () => {
  const { config } = await import('../src/config.js');
  config.assistant.cli.gemini = false;
  process.env.FAKE_GPT = '- Thiếu ngân sách';
  const n = calls().length;
  await say('đề xuất giá bán mới');
  assert.equal(sent.at(-1), 'Bản sửa có ngân sách\n\n— Claude soạn, GPT phản biện, Claude cân nhắc và chỉnh sửa.');
  assert.deepEqual(calls().slice(n).map((c) => c.kind), ['claude', 'codex', 'claude']);
  config.assistant.cli.gemini = true;
});
