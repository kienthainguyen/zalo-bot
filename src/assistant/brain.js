// Bộ điều phối Trợ lí 3 AI: Claude làm việc (có công cụ), GPT phản biện, Gemini trọng tài.
import { ai, claudeTextOf } from './ai.js';
import { config } from '../config.js';
import * as store from './store.js';
import { startAgentTask, answerAgentTask, activeAgentTasks } from './tasks.js';
import crypto from 'node:crypto';

const PLAIN_TEXT_RULE =
  "Tin nhắn gửi qua Zalo nên KHÔNG dùng Markdown (không dùng **, #, bảng). " +
  "Dùng câu ngắn, xuống dòng, gạch đầu dòng bằng dấu '-' hoặc số thứ tự. " +
  "Viết tiếng Việt có dấu, xưng 'em', gọi người dùng là 'anh'.";

export const WORKER_SYSTEM = `Bạn là trợ lí riêng của anh Kiên (thương hiệu Trà Kiên Thái Nguyên), làm mọi việc anh giao qua Zalo: ghi nhớ công việc, phân tích, tổng hợp, đề xuất, lập kế hoạch, hướng dẫn cách làm, soạn văn bản, tra cứu, báo cáo.

Nguyên tắc:
- Khi anh giao việc, nhắc việc hoặc kể việc đã làm: dùng công cụ để lưu/cập nhật công việc. Tự suy ra hạn chót (YYYY-MM-DD) từ các cụm như "mai", "thứ 6", "cuối tháng" dựa vào ngày hôm nay.
- Khi anh nói "đã xong", "hoàn thành", "xong rồi": tìm đúng việc trong danh sách và đánh dấu done. Không chắc là việc nào thì hỏi lại.
- Thông tin lâu dài về anh (sở thích, người liên quan, mục tiêu, thói quen, dự án): lưu bằng save_memory. Thông tin cũ đã sai thì delete_memory.
- Việc cần thông tin mới (giá, tin tức, quy định): dùng web_search.
- Khi lập kế hoạch: chia bước cụ thể, có thời hạn, đề xuất tạo các việc tương ứng (hoặc tạo luôn nếu anh yêu cầu).
- Trả lời đúng trọng tâm, thực tế, ngắn gọn; chỉ dài khi anh cần phân tích sâu.
- Không bịa số liệu. Không chắc thì nói rõ.
- Bạn có một trợ lí thực thi chạy trên VPS của anh (Claude Code điều khiển Chrome đã đăng nhập Google của anh, có Bash, tìm kiếm web). Anh muốn được làm thay tối đa. Khi anh yêu cầu việc cần thao tác thật (tạo fanpage Facebook, tạo kênh YouTube, đăng bài, điền form, đăng ký tài khoản, tải/sửa file, kiểm tra một trang web, gửi email...): gọi start_task ngay, không hỏi lại những chi tiết tự quyết được. Viết instructions đầy đủ vì trợ lí thực thi không thấy cuộc trò chuyện: mục tiêu, kết quả mong muốn, mọi chi tiết anh đã nói, thông tin liên quan trong phần ghi nhớ (tên thương hiệu, sản phẩm, phong cách). Sau đó trả lời anh 1 câu ngắn là em đã giao việc và sẽ báo khi xong hoặc khi cần anh làm gì.
- Khi có "Việc đang chạy" chờ anh trả lời và tin của anh là câu trả lời / bổ sung / lệnh dừng cho việc đó: gọi answer_task để chuyển nguyên ý anh, rồi trả lời 1 câu ngắn.
- Các lệnh dựng video có sẵn (vd "Edit cho a 10 video mới về trà", "Dựng cho a 3 video đồ họa giải thích về chủ đề "..."") chạy bằng luồng riêng: nếu anh muốn dựng video, nhắc anh nhắn đúng câu lệnh, không dùng start_task.
${PLAIN_TEXT_RULE}`;

export const CRITIC_SYSTEM =
  'Bạn là người phản biện độc lập, nghiêm khắc nhưng công bằng. Bạn đọc yêu cầu của anh Kiên và bản trả lời do một AI khác (Claude) soạn. ' +
  'Hãy chỉ ra: sai sót về sự kiện/logic, chỗ thiếu quan trọng, rủi ro chưa nêu, phương án tốt hơn, chỗ chưa khả thi hoặc mơ hồ. ' +
  'Mỗi ý một gạch đầu dòng, ngắn gọn, xếp theo mức quan trọng. Không khen. ' +
  'Nếu bản trả lời đã tốt và không có vấn đề đáng kể, chỉ viết đúng: KHÔNG CÓ VẤN ĐỀ. Viết tiếng Việt.';

export const JUDGE_SYSTEM = `Bạn là trọng tài. Bạn nhận: yêu cầu của anh Kiên, bản trả lời của Claude, và ý kiến phản biện của GPT. Hãy cân nhắc khách quan từng ý phản biện: ý nào đúng và đáng sửa, ý nào sai hoặc không cần thiết.
Trả về JSON đúng dạng:
{"verdict": "approve" hoặc "revise",
 "reason": "1-2 câu giải thích quyết định",
 "instructions": "nếu revise: danh sách cụ thể những gì Claude cần sửa; nếu approve: chuỗi rỗng"}
Chỉ chọn "revise" khi việc sửa thực sự làm câu trả lời tốt hơn đáng kể cho anh Kiên.`;

export const REVISE_SYSTEM =
  'Bạn là trợ lí riêng của anh Kiên. Hãy viết lại bản trả lời của mình theo chỉ đạo của trọng tài (đã cân nhắc ý kiến phản biện). ' +
  'Giữ những gì đúng, sửa những gì được yêu cầu. Chỉ xuất bản trả lời cuối cùng gửi cho anh Kiên, không nhắc tới trọng tài hay phản biện. ' +
  PLAIN_TEXT_RULE;

const DEEP_KEYWORDS = [
  'phân tích', 'kế hoạch', 'đề xuất', 'chiến lược', 'tổng hợp', 'báo cáo', 'đánh giá',
  'so sánh', 'tư vấn', 'giải pháp', 'lộ trình', 'rủi ro', 'nên làm', 'có nên',
];

const TOOLS = [
  {
    name: 'add_task',
    description: 'Tạo một công việc mới (việc anh giao, việc sắp làm, hoặc việc đã làm xong cần ghi lại).',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tên công việc, ngắn gọn rõ ràng' },
        due: { type: 'string', description: 'Hạn chót dạng YYYY-MM-DD, nếu có' },
        priority: { type: 'string', enum: ['high', 'normal', 'low'] },
        status: { type: 'string', enum: ['todo', 'doing', 'done'], description: 'Mặc định todo; dùng done nếu anh kể việc đã làm xong' },
        notes: { type: 'string', description: 'Ghi chú thêm' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Cập nhật công việc theo id: đổi trạng thái (todo/doing/done/cancelled), hạn, tên, ưu tiên, ghi chú.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        status: { type: 'string', enum: store.TASK_STATUSES },
        title: { type: 'string' },
        due: { type: 'string', description: 'YYYY-MM-DD, hoặc chuỗi rỗng để bỏ hạn' },
        priority: { type: 'string', enum: ['high', 'normal', 'low'] },
        notes: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_tasks',
    description: 'Xem danh sách công việc. status: open (chưa xong), todo, doing, done, cancelled, all.',
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['open', 'todo', 'doing', 'done', 'cancelled', 'all'] } },
    },
  },
  {
    name: 'start_task',
    description:
      'Giao một việc cần thao tác thật (trình duyệt, tài khoản online, file, web) cho trợ lí thực thi trên VPS. Nó tự làm, chỉ hỏi anh qua Zalo khi cần anh đăng nhập, xác minh, thanh toán, và tự báo kết quả.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tên việc ngắn, vd "Tạo fanpage Trà Kiên Thái Nguyên"' },
        instructions: { type: 'string', description: 'Mô tả đầy đủ: mục tiêu, kết quả cần có, mọi chi tiết và bối cảnh liên quan' },
      },
      required: ['title', 'instructions'],
    },
  },
  {
    name: 'answer_task',
    description: 'Chuyển câu trả lời, thông tin bổ sung hoặc lệnh dừng của anh tới một việc thực thi đang chạy.',
    input_schema: {
      type: 'object',
      properties: { job_id: { type: 'string' }, message: { type: 'string' } },
      required: ['job_id', 'message'],
    },
  },
  {
    name: 'save_memory',
    description: 'Ghi nhớ lâu dài một thông tin quan trọng về anh Kiên, công việc, người liên quan.',
    input_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
  },
  {
    name: 'delete_memory',
    description: 'Xoá một ghi nhớ đã cũ hoặc sai, theo id.',
    input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  },
];

function tools() {
  const list = [...TOOLS];
  if (config.assistant.webSearch) list.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 5 });
  return list;
}

export function runTool(name, input = {}, ctx = {}) {
  try {
    switch (name) {
      case 'start_task': {
        if (!ctx.chatId) return 'Lỗi: không có chat để báo kết quả.';
        const { job, position } = startAgentTask({ ...input, chatId: ctx.chatId, userId: ctx.userId });
        ctx.startedTask = job.id;
        return `Đã giao việc (mã ${job.id})` + (position > 1 ? `, đang xếp hàng sau ${position - 1} việc khác.` : ', đang bắt đầu làm.');
      }
      case 'answer_task': {
        const r = answerAgentTask(input.job_id, input.message);
        if (!r) return 'Không tìm thấy việc này.';
        return r.closed ? `Việc này đã kết thúc (${r.job.status}), cần giao việc mới nếu muốn làm tiếp.` : 'Đã chuyển lời anh tới việc đang chạy.';
      }
      case 'add_task':
        return 'Đã tạo: ' + store.formatTask(store.addTask(input));
      case 'update_task': {
        const { id, ...fields } = input;
        const t = store.updateTask(id, fields);
        return t ? 'Đã cập nhật: ' + store.formatTask(t) : 'Không tìm thấy việc này.';
      }
      case 'list_tasks': {
        const ts = store.listTasks(input.status || 'open');
        return ts.map(store.formatTask).join('\n') || 'Không có việc nào.';
      }
      case 'save_memory':
        return `Đã ghi nhớ (#${store.addMemory(input.content).id}).`;
      case 'delete_memory':
        return store.deleteMemory(input.id) ? 'Đã xoá.' : 'Không tìm thấy.';
      default:
        return `Không có công cụ ${name}.`;
    }
  } catch (e) {
    return `Lỗi: ${e.message}`;
  }
}

// Bối cảnh đưa vào mỗi lần gọi Claude: giờ VN, ghi nhớ, việc chưa xong, việc xong 7 ngày qua.
export function contextBlock() {
  const n = store.nowInfo();
  const lines = [`Hôm nay: ${n.label} (giờ Việt Nam).`];
  const mems = store.listMemories();
  if (mems.length) {
    lines.push('', 'Những điều em đã ghi nhớ về anh:');
    for (const m of mems) lines.push(`[${m.id}] ${m.content}`);
  }
  lines.push('', 'Việc chưa xong:');
  const open = store.listTasks('open', 60);
  lines.push(...(open.length ? open.map(store.formatTask) : ['(không có)']));
  const running = activeAgentTasks();
  if (running.length) {
    lines.push('', 'Việc đang chạy trên VPS (trợ lí thực thi):');
    for (const j of running) {
      lines.push(`[${j.id}] ${j.title} (${j.status === 'queued' ? 'đang xếp hàng' : 'đang làm'})` + (j.waiting ? ` - đang chờ anh trả lời: ${j.waiting}` : ''));
    }
  }
  const since = store.ymd(store.addDays(n.v, -7));
  const done = store.tasksDoneBetween(since, '9999');
  if (done.length) {
    lines.push('', 'Việc đã xong 7 ngày qua:');
    lines.push(...done.slice(-30).map(store.formatTask));
  }
  return lines.join('\n');
}

function systemBlocks(staticText) {
  // Phần cố định để đầu (được cache), phần thay đổi theo ngày giờ để sau.
  return [
    { type: 'text', text: staticText, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: contextBlock() },
  ];
}

// 16 tin gần nhất, gộp các tin liền nhau cùng vai, bắt đầu bằng tin của anh.
function historyMessages(limit = 16) {
  const msgs = [];
  for (const m of store.recentMessages(limit)) {
    if (msgs.at(-1)?.role === m.role) msgs.at(-1).content += '\n\n' + m.content;
    else msgs.push({ role: m.role, content: m.content });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

// Zalo không hiện Markdown: bỏ các ký hiệu còn sót.
export function toPlain(text) {
  return String(text)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*\*\s+/gm, '- ')
    .replace(/`{1,3}/g, '')
    .trim();
}

// ---------- Claude Code (gói Claude Max) gọi công cụ bằng curl về bot ----------
const sessions = new Map(); // phiên đang chạy -> ctx
const sessionToken = (id) => crypto.createHmac('sha256', config.notifySecret || 'local').update('assistant:' + id).digest('hex').slice(0, 32);

// Gọi từ POST /api/assistant/tool. Trả null nếu phiên/token sai.
export function runSessionTool({ session, token, name, input }) {
  const ctx = sessions.get(session);
  if (!ctx || typeof token !== 'string' || token !== sessionToken(session)) return null;
  return runTool(String(name), input && typeof input === 'object' ? input : {}, ctx);
}

function toolGuide(session) {
  const url = `http://127.0.0.1:${config.port}/api/assistant/tool`;
  const list = TOOLS.map((t) => `- ${t.name}: ${t.description}\n  input: ${JSON.stringify(t.input_schema.properties)}` + (t.input_schema.required ? ` (bắt buộc: ${t.input_schema.required.join(', ')})` : '')).join('\n');
  return `## Công cụ của trợ lí
Gọi bằng curl (mỗi lần 1 công cụ, kết quả trả về dạng {"result": "..."}):
curl -sS -X POST ${url} -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"session":"${session}","token":"${sessionToken(session)}","name":"<tên công cụ>","input":{...}}
JSON

${list}
Tìm thông tin mới trên mạng: dùng WebSearch / WebFetch.
Câu trả lời cuối cùng của bạn chính là tin nhắn gửi anh trên Zalo: chỉ viết nội dung tin nhắn, không nhắc tới curl, công cụ, phiên.`;
}

async function runWorkerCli(ctx) {
  const session = crypto.randomUUID();
  sessions.set(session, ctx);
  try {
    const history = store
      .recentMessages(16)
      .map((m) => `${m.role === 'user' ? 'Anh' : 'Em'}: ${m.content}`)
      .join('\n\n');
    const prompt = `${contextBlock()}\n\n## Cuộc trò chuyện gần đây (tin cuối là tin mới của anh, cần trả lời)\n${history}`;
    return await ai.claudeAgent(`${WORKER_SYSTEM}\n\n${toolGuide(session)}`, prompt, ['Bash(curl:*)', 'WebSearch', 'WebFetch']);
  } finally {
    sessions.delete(session);
  }
}

// Claude xử lý tin mới nhất (đã lưu trong lịch sử), có dùng công cụ.
// Không có ANTHROPIC_API_KEY: dùng Claude Code (gói Claude Max). Có khoá: dùng API.
export async function runWorker({ effort = 'medium', maxSteps = 10, ctx = {} } = {}) {
  if (!config.assistant.anthropicKey) return (await runWorkerCli(ctx)) || 'Dạ em đã ghi nhận.';
  const messages = historyMessages();
  const system = systemBlocks(WORKER_SYSTEM);
  let text = '';
  for (let step = 0; step < maxSteps; step++) {
    const resp = await ai.claude({ max_tokens: 8000, system, tools: tools(), output_config: { effort }, messages });
    if (resp.stop_reason === 'refusal') return 'Em không làm được yêu cầu này, anh diễn đạt lại giúp em nhé.';
    text = claudeTextOf(resp) || text;
    messages.push({ role: 'assistant', content: resp.content });
    if (resp.stop_reason === 'pause_turn') continue; // tìm kiếm web đang chạy dở
    if (resp.stop_reason !== 'tool_use') break;
    const results = resp.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: runTool(b.name, b.input, ctx) }));
    messages.push({ role: 'user', content: results });
  }
  return text || 'Dạ em đã ghi nhận.';
}

export function needsCouncil(text) {
  const mode = store.getSetting('mode') || 'auto';
  if (mode === 'always') return true;
  if (mode === 'fast') return false;
  const low = String(text).normalize('NFC').toLowerCase();
  // "kỹ" (làm kỹ, xem kỹ, kỹ càng) nhưng không tính "kỹ thuật", "kỹ năng", "kỹ sư"...
  const ky = /(^|[^\p{L}])(kỹ|kĩ)(?!\s+(thuật|năng|sư|xảo|nghệ))([^\p{L}]|$)/u.test(low);
  return text.length > 300 || ky || DEEP_KEYWORDS.some((k) => low.includes(k));
}

const errName = (e) => e?.constructor?.name || 'Error';

// GPT phản biện, Gemini trọng tài, Claude sửa 1 lần nếu cần. Trả {text, note}.
export async function council(request, draft) {
  let critique;
  try {
    critique = await ai.gptText(CRITIC_SYSTEM, `YÊU CẦU CỦA ANH KIÊN:\n${request}\n\nBẢN TRẢ LỜI CỦA CLAUDE:\n${draft}`);
  } catch (e) {
    console.error('[assistant] GPT lỗi', e);
    return { text: draft, note: `(GPT tạm thời không phản biện được: ${errName(e)})` };
  }
  if (!critique || critique.toUpperCase().slice(0, 40).includes('KHÔNG CÓ VẤN ĐỀ')) {
    return { text: draft, note: '— Claude soạn, GPT phản biện: không có vấn đề.' };
  }
  let verdict;
  try {
    verdict = await ai.geminiJson(
      JUDGE_SYSTEM,
      `YÊU CẦU:\n${request}\n\nBẢN TRẢ LỜI CỦA CLAUDE:\n${draft}\n\nPHẢN BIỆN CỦA GPT:\n${critique}`,
    );
  } catch (e) {
    console.error('[assistant] Gemini lỗi', e);
    verdict = {
      verdict: 'revise',
      reason: `Gemini lỗi (${errName(e)}), Claude tự cân nhắc phản biện.`,
      instructions: 'Tự cân nhắc các ý phản biện sau, chỉ sửa những ý đúng:\n' + critique,
    };
  }
  if (verdict.verdict !== 'revise') {
    return { text: draft, note: '— Claude soạn, GPT phản biện, Gemini duyệt: giữ nguyên.' };
  }
  let revised = '';
  try {
    revised = await ai.claudeText(
      [{ type: 'text', text: REVISE_SYSTEM }, { type: 'text', text: contextBlock() }],
      `YÊU CẦU CỦA ANH KIÊN:\n${request}\n\nBẢN TRẢ LỜI CŨ CỦA BẠN:\n${draft}\n\n` +
        `Ý KIẾN PHẢN BIỆN (GPT):\n${critique}\n\nCHỈ ĐẠO CỦA TRỌNG TÀI (Gemini):\n${verdict.instructions || ''}`,
      { effort: 'high' },
    );
  } catch (e) {
    console.error('[assistant] Claude sửa lỗi', e);
  }
  if (!revised) return { text: draft, note: '— Claude soạn, GPT phản biện; bản sửa bị lỗi nên giữ bản đầu.' };
  const reason = String(verdict.reason || '').trim();
  return { text: revised, note: `— Claude soạn, GPT phản biện, Gemini yêu cầu chỉnh sửa${reason ? `: ${reason}` : '.'}` };
}

// Xử lý 1 tin nhắn thường của anh. Trả về câu trả lời gửi Zalo.
// chatId/userId: để việc thực thi biết báo kết quả về đâu.
export async function handleMessage(text, { deep = needsCouncil(text), chatId, userId } = {}) {
  store.addMessage('user', text);
  const ctx = { chatId, userId, startedTask: null };
  let reply = toPlain(await runWorker({ effort: deep ? 'high' : 'medium', ctx }));
  let note = '';
  // Đã giao việc thực thi thì câu trả lời chỉ là xác nhận, không cần phản biện.
  if (deep && !ctx.startedTask) ({ text: reply, note } = await council(text, reply));
  reply = toPlain(reply);
  store.addMessage('assistant', reply);
  return note ? `${reply}\n\n${note}` : reply;
}

// ---------- báo cáo ----------
function reportData(start, end) {
  const today = store.nowInfo().date;
  const open = store.listTasks('open', 100);
  return JSON.stringify(
    {
      khoang_thoi_gian: `${start} đến ${end} (không tính ngày cuối)`,
      viec_da_xong: store.tasksDoneBetween(start, end).map(store.formatTask),
      viec_moi_giao: store.tasksCreatedBetween(start, end).map(store.formatTask),
      viec_chua_xong: open.map(store.formatTask),
      viec_qua_han: open.filter((t) => t.due && t.due < today).map(store.formatTask),
      cac_yeu_cau_cua_anh: store
        .messagesBetween(start, end)
        .filter((m) => m.role === 'user')
        .slice(-80)
        .map((m) => m.content.slice(0, 200)),
    },
    null,
    1,
  );
}

export const REPORT_TITLES = { day: 'NHẮC VIỆC SÁNG NAY', week: 'BÁO CÁO TUẦN', month: 'BÁO CÁO THÁNG' };

// kind: day | week | month. Trả về nội dung đã có tiêu đề.
export async function makeReport(kind) {
  const n = store.nowInfo();
  const tomorrow = store.ymd(store.addDays(n.v, 1));
  if (kind === 'day') {
    if (!store.listTasks('open', 1).length) return `${REPORT_TITLES.day}\n\nHôm nay anh chưa có việc nào trong danh sách.`;
    const prompt =
      'Viết bản nhắc việc buổi sáng cho anh Kiên: các việc cần làm hôm nay và việc quá hạn trước, ' +
      'rồi việc sắp tới hạn trong 3 ngày, gợi ý 3 việc nên ưu tiên nhất. Ngắn gọn.\n\n' +
      reportData(n.date, tomorrow);
    const text = await ai.claudeText(systemBlocks(WORKER_SYSTEM), prompt, { maxTokens: 3000 });
    return `${REPORT_TITLES.day}\n\n${toPlain(text)}`;
  }
  let start;
  let period;
  if (kind === 'week') {
    start = store.ymd(store.addDays(n.v, -7));
    period = 'tuần qua (7 ngày gần nhất)';
  } else {
    const first = new Date(Date.UTC(n.v.getUTCFullYear(), n.v.getUTCMonth(), 1));
    // Ngày 1: báo cáo tháng trước; ngày khác: từ đầu tháng này tới nay.
    start = n.day === 1 ? store.ymd(new Date(Date.UTC(n.v.getUTCFullYear(), n.v.getUTCMonth() - 1, 1))) : store.ymd(first);
    period = n.day === 1 ? 'tháng trước' : 'từ đầu tháng tới nay';
  }
  const end = kind === 'month' && n.day === 1 ? n.date : tomorrow;
  const request =
    `Viết ${REPORT_TITLES[kind]} (${period}) cho anh Kiên dựa trên dữ liệu bên dưới, gồm: 1) Tổng quan (số việc xong, mới, ` +
    'còn lại, quá hạn), 2) Việc đã hoàn thành nổi bật, 3) Việc còn tồn đọng và quá hạn, ' +
    '4) Nhận xét: điểm tốt, điểm cần cải thiện, 5) Đề xuất kế hoạch và ưu tiên cho kỳ tới.\n\n' +
    reportData(start, end);
  const draft = toPlain(await ai.claudeText(systemBlocks(WORKER_SYSTEM), request, { effort: 'high' }));
  const { text, note } = await council(request, draft);
  const final = `${REPORT_TITLES[kind]}\n\n${toPlain(text)}`;
  store.addMessage('assistant', final);
  return `${final}\n\n${note}`;
}
