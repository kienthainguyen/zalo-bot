// Kiểm thử Trợ lí 3 AI: thay Claude, GPT, Gemini bằng hàm giả, không gọi mạng thật.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zbot-ai-'));
process.env.AI_WORK_DIR = path.join(process.env.DATA_DIR, 'ai-work');
process.env.ALLOWED_ZALO_IDS = 'owner1';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.OPENAI_API_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';
delete process.env.CLAUDE_MODEL;

const { ai } = await import('../src/assistant/ai.js');
const store = await import('../src/assistant/store.js');
const assistant = await import('../src/assistant/index.js');
const brain = await import('../src/assistant/brain.js');
const { handleMessage: route, looksLikeChat } = await import('../src/router.js');
const { normalize } = await import('../src/text.js');
const { agentEnv } = await import('../src/executors/local-claude.js');

// Thời điểm giả: giờ Việt Nam = UTC + 7.
const vn = (s) => new Date(new Date(s + 'Z').getTime() - 7 * 3600 * 1000);
store.setClock(() => vn('2026-11-13T09:00:00')); // Thứ Sáu

// Claude giả: trả lần lượt các phản hồi trong `script`, ghi lại tham số mỗi lần gọi.
let script = [];
let calls = [];
const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const toolUse = (name, input) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'text', text: '' }, { type: 'tool_use', id: 'tu_' + calls.length, name, input }],
});
ai.claude = async (params) => {
  calls.push(structuredClone(params));
  const next = script.shift();
  if (!next) throw new Error('Claude giả hết kịch bản');
  return typeof next === 'function' ? next(params) : next;
};
let gpt = async () => 'KHÔNG CÓ VẤN ĐỀ';
let gemini = async () => ({ verdict: 'approve', reason: '', instructions: '' });
const gptCalls = [];
ai.gptText = async (...a) => (gptCalls.push(a), gpt(...a));
ai.geminiJson = async (...a) => gemini(...a);

const sent = [];
const send = async (t) => {
  sent.push(t);
};
const say = (t) => route({ chatId: 'chat1', userId: 'owner1', name: 'Kiên', text: t }, send);

beforeEach(() => {
  script = [];
  calls = [];
  sent.length = 0;
});

test('lưu việc, đánh dấu xong, định dạng', () => {
  const t = store.addTask({ title: 'Nộp báo cáo quý', due: '2026-11-14', priority: 'high' });
  assert.equal(store.formatTask(t), `#${t.id} Nộp báo cáo quý [sắp làm, ưu tiên cao, hạn 2026-11-14]`);
  assert.throws(() => store.addTask({ title: 'x', due: 'thứ 6' }), /YYYY-MM-DD/);
  const d = store.updateTask(t.id, { status: 'done' });
  assert.equal(d.done_at, '2026-11-13 09:00');
  assert.equal(store.updateTask(t.id, { status: 'todo' }).done_at, null);
});

test('lệnh nhanh /viec /xong /nho /chedo', async () => {
  const t = store.addTask({ title: 'Gọi khách hàng A' });
  await say('/viec');
  assert.match(sent.at(-1), /Gọi khách hàng A/);
  await say(`/xong ${t.id}`);
  assert.match(sent.at(-1), /^Đã xong: .*Gọi khách hàng A \[đã xong/);
  await say('/xong 999');
  assert.match(sent.at(-1), /không tìm thấy việc #999/);
  await say('/xong abc');
  assert.match(sent.at(-1), /\/xong 12/);
  store.addMemory('Anh Kiên bán trà Thái Nguyên');
  await say('/nho');
  assert.match(sent.at(-1), /bán trà Thái Nguyên/);
  await say('/chedo nhanh');
  assert.match(sent.at(-1), /chỉ Claude/);
  await say('/chedo tudong');
  assert.match(sent.at(-1), /tự động/);
  assert.equal(calls.length, 0, 'lệnh nhanh không gọi AI');
});

test('tin thường: Claude dùng công cụ tạo việc, không chạy phản biện', async () => {
  script = [toolUse('add_task', { title: 'Nộp hồ sơ thuế', due: '2026-11-20' }), text('Dạ em đã ghi: **Nộp hồ sơ thuế**, hạn 20/11.')];
  await say('Thứ 6 tuần sau nộp hồ sơ thuế');
  assert.equal(sent.length, 1);
  assert.equal(sent[0], 'Dạ em đã ghi: Nộp hồ sơ thuế, hạn 20/11.'); // bỏ Markdown
  assert.ok(store.listTasks('open').some((t) => t.title === 'Nộp hồ sơ thuế' && t.due === '2026-11-20'));
  assert.equal(gptCalls.length, 0);

  const p = calls[0];
  assert.equal(p.output_config.effort, 'medium');
  assert.equal(p.thinking, undefined);
  assert.ok(p.tools.some((t) => t.type === 'web_search_20260209'));
  assert.match(p.system[1].text, /Hôm nay: Thứ Sáu, 13\/11\/2026 09:00/);
  assert.equal(p.messages.at(-1).role, 'user');
  assert.equal(p.messages.at(-1).content, 'Thứ 6 tuần sau nộp hồ sơ thuế');
  // lần gọi 2 có kết quả công cụ trong 1 tin user
  const last = calls[1].messages.at(-1);
  assert.equal(last.role, 'user');
  assert.equal(last.content[0].type, 'tool_result');
  assert.match(last.content[0].content, /^Đã tạo: #\d+ Nộp hồ sơ thuế/);
});

test('ai.claude dùng model mặc định claude-opus-5-5', async () => {
  const { config } = await import('../src/config.js');
  assert.equal(config.assistant.claudeModel, 'claude-opus-5-5');
});

test('việc quan trọng: GPT phản biện, Gemini bắt sửa, Claude viết lại 1 lần', async () => {
  gpt = async () => '- Thiếu ngân sách\n- Chưa có mốc thời gian';
  gemini = async (sys, prompt) => {
    assert.match(prompt, /PHẢN BIỆN CỦA GPT:\n- Thiếu ngân sách/);
    return { verdict: 'revise', reason: 'Cần thêm ngân sách và mốc thời gian.', instructions: 'Thêm ngân sách, mốc thời gian' };
  };
  script = [text('Kế hoạch bản đầu'), text('Kế hoạch bản sửa có ngân sách')];
  await say('Lập kế hoạch mở chi nhánh mới trong 3 tháng');
  assert.match(sent[0], /GPT phản biện và Gemini duyệt/);
  assert.equal(
    sent[1],
    'Kế hoạch bản sửa có ngân sách\n\n— Claude soạn, GPT phản biện, Gemini yêu cầu chỉnh sửa: Cần thêm ngân sách và mốc thời gian.',
  );
  assert.equal(calls[0].output_config.effort, 'high');
  assert.match(calls[1].messages[0].content, /CHỈ ĐẠO CỦA TRỌNG TÀI \(Gemini\):\nThêm ngân sách/);
  // lịch sử lưu bản cuối, không kèm ghi chú
  assert.equal(store.recentMessages(1)[0].content, 'Kế hoạch bản sửa có ngân sách');
});

test('chữ "kỹ" bật đủ 3 AI; GPT không có vấn đề thì giữ nguyên', async () => {
  gpt = async () => 'KHÔNG CÓ VẤN ĐỀ';
  script = [text('Trả lời kỹ')];
  await say('xem kỹ giúp anh hợp đồng này');
  assert.equal(sent.at(-1), 'Trả lời kỹ\n\n— Claude soạn, GPT phản biện: không có vấn đề.');
  assert.equal(brain.needsCouncil('kỹ thuật pha trà'), false);
});

test('GPT lỗi thì vẫn gửi bản của Claude; Gemini lỗi thì Claude tự cân nhắc', async () => {
  gpt = async () => {
    throw new TypeError('mạng lỗi');
  };
  script = [text('Bản phân tích')];
  await say('phân tích đối thủ giúp anh');
  assert.equal(sent.at(-1), 'Bản phân tích\n\n(GPT tạm thời không phản biện được: TypeError)');

  gpt = async () => '- Sai số liệu';
  gemini = async () => {
    throw new Error('503');
  };
  script = [text('Bản đầu'), text('Bản tự sửa')];
  await say('đề xuất giá bán mới');
  assert.match(sent.at(-1), /^Bản tự sửa\n\n— Claude soạn, GPT phản biện, Gemini yêu cầu chỉnh sửa: Gemini lỗi/);
  gemini = async () => ({ verdict: 'approve' });
});

test('chế độ nhanh: không chạy phản biện kể cả việc phân tích', async () => {
  store.setSetting('mode', 'fast');
  script = [text('Nhanh')];
  await say('phân tích nhanh');
  assert.deepEqual(sent, ['Nhanh']);
  store.setSetting('mode', 'auto');
});

test('Claude từ chối thì báo ngắn', async () => {
  script = [{ stop_reason: 'refusal', content: [] }];
  await say('abc');
  assert.match(sent.at(-1), /không làm được/);
});

test('câu trò chuyện có nhắc video trà không chạy luồng dựng video', () => {
  for (const t of [
    'lập kế hoạch dựng video trà tuần sau',
    'xong việc edit video trà rồi',
    'dựng video trà mất bao lâu?',
    'làm báo cáo về video trà',
  ]) {
    assert.ok(looksLikeChat(normalize(t)), t);
  }
  for (const t of [
    'Edit cho a 10 video mới về trà',
    'dựng 5 video chè',
    'dựng cho a 3 video đồ họa giải thích về chủ đề "Kế hoạch kinh doanh trà"',
    'tạo video đồ họa về “Trà shan tuyết là gì?”',
  ]) {
    assert.ok(!looksLikeChat(normalize(t)), t);
  }
});

test('lịch tự động: 7h nhắc việc, 8h thứ Hai báo cáo tuần, 8h ngày 1 báo cáo tháng, không gửi trùng', async () => {
  store.setClock(() => vn('2026-11-16T06:59:00')); // Thứ Hai
  assert.deepEqual(assistant.dueReports(), []);
  store.setClock(() => vn('2026-11-16T07:00:00'));
  assert.deepEqual(assistant.dueReports(), ['day']);
  store.setClock(() => vn('2026-11-16T08:00:00'));
  assert.deepEqual(assistant.dueReports(), ['day', 'week']);

  gpt = async () => 'KHÔNG CÓ VẤN ĐỀ';
  script = [text('Hôm nay làm việc A'), text('Tuần qua anh làm tốt')];
  const out = [];
  await assistant.runDueReports(async (t) => out.push(t));
  assert.match(out[0], /^NHẮC VIỆC SÁNG NAY\n\nHôm nay làm việc A/);
  assert.match(out[1], /^BÁO CÁO TUẦN\n\nTuần qua anh làm tốt\n\n— Claude soạn, GPT phản biện/);
  assert.match(calls[1].messages[0].content, /viec_qua_han/);
  assert.deepEqual(assistant.dueReports(), []);

  store.setClock(() => vn('2026-11-16T13:00:00'));
  assert.deepEqual(assistant.dueReports(), []); // quá giờ thì không gửi bù

  store.setClock(() => vn('2026-12-01T08:30:00')); // Thứ Ba, ngày 1
  assert.deepEqual(assistant.dueReports(), ['day', 'month']);
  script = [text('a'), text('Tháng 11 anh xong 3 việc')];
  out.length = 0;
  await assistant.runDueReports(async (t) => out.push(t));
  assert.match(out[1], /^BÁO CÁO THÁNG\n\nTháng 11/);
  assert.match(calls.at(-1).messages[0].content, /2026-11-01 đến 2026-12-01/);
  store.setClock(() => vn('2026-11-13T09:00:00'));
});

test('/baocao tuan: báo đang làm rồi gửi báo cáo', async () => {
  script = [text('Báo cáo tuần')];
  await say('/baocao tuan');
  assert.match(sent[0], /đang làm báo cáo/);
  assert.match(sent[1], /^BÁO CÁO TUẦN/);
  await say('/baocao nam');
  assert.match(sent.at(-1), /\/baocao ngay/);
});

test('ghi nhớ chat của anh để gửi báo cáo tự động', () => {
  assert.equal(store.getSetting('owner_chat_id'), 'chat1');
});

test('Claude Code trên VPS không thấy khoá API của trợ lí', () => {
  const env = agentEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y', GEMINI_API_KEY: 'z' });
  assert.deepEqual(env, { PATH: '/bin' });
});
