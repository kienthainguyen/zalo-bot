// Trợ lí 3 AI: lệnh nhanh (/viec, /xong, /baocao, /nho, /chedo), trả lời tin thường, lịch báo cáo tự động.
import { config } from '../config.js';
import * as store from './store.js';
import { handleMessage, makeReport, needsCouncil } from './brain.js';

export const ASSISTANT_HELP = `Trợ lí 3 AI (Claude làm, GPT phản biện, Gemini trọng tài): anh cứ nhắn bình thường, ví dụ
- "Thứ 6 nộp báo cáo quý cho sếp"
- "Xong việc gọi khách hàng A rồi"
- "Lập kế hoạch mở chi nhánh mới trong 3 tháng"
Việc phân tích, kế hoạch, đề xuất, báo cáo, hoặc có chữ "kỹ" sẽ chạy đủ 3 AI.
Lệnh nhanh:
/viec - việc chưa xong
/xong 12 - đánh dấu việc #12 đã xong
/baocao ngay | tuan | thang - báo cáo ngay
/nho - xem những điều em ghi nhớ
/chedo tudong | luon | nhanh - lúc nào chạy đủ 3 AI
Tự động: 7h sáng nhắc việc, 8h thứ Hai báo cáo tuần, 8h ngày 1 báo cáo tháng.`;

const MODES = { tudong: 'auto', luon: 'always', nhanh: 'fast' };
const MODE_VI = {
  auto: 'tự động (việc phân tích, kế hoạch, báo cáo mới chạy đủ 3 AI)',
  always: 'luôn chạy đủ 3 AI',
  fast: 'chỉ Claude, nhanh và rẻ',
};
const REPORT_KINDS = { ngay: 'day', tuan: 'week', thang: 'month' };

export const assistantEnabled = () => Boolean(config.assistant.anthropicKey);
const DISABLED =
  'Trợ lí 3 AI chưa bật: VPS chưa có ANTHROPIC_API_KEY trong file .env. Anh thêm khoá rồi khởi động lại bot nhé.';

// Chạy lần lượt từng việc của trợ lí (tin nhắn, báo cáo) để lịch sử không bị xen nhau.
let chain = Promise.resolve();
function enqueue(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

const ASSISTANT_COMMANDS = ['viec', 'xong', 'baocao', 'nho', 'chedo'];
export function isAssistantCommand(text) {
  const m = String(text).trim().match(/^\/(\S+)/);
  return Boolean(m && ASSISTANT_COMMANDS.includes(m[1].toLowerCase()));
}

// Lệnh nhanh. Trả về chuỗi trả lời, hoặc null nếu không phải lệnh nhanh.
export async function handleCommand(text) {
  const m = String(text).trim().match(/^\/(\S+)\s*(.*)$/s);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const arg = m[2].trim().toLowerCase();
  if (cmd === 'viec') {
    const ts = store.listTasks('open');
    return ts.length ? 'Việc chưa xong:\n' + ts.map(store.formatTask).join('\n') : 'Anh không còn việc nào tồn đọng.';
  }
  if (cmd === 'xong') {
    const id = Number(arg.replace(/^#/, ''));
    if (!Number.isInteger(id) || id < 1) return 'Anh nhắn dạng: /xong 12';
    const t = store.getTask(id) && store.updateTask(id, { status: 'done' });
    return t ? `Đã xong: ${store.formatTask(t)}` : `Em không tìm thấy việc #${id}.`;
  }
  if (cmd === 'nho') {
    const ms = store.listMemories();
    return ms.length ? 'Em đang ghi nhớ:\n' + ms.map((x) => `[${x.id}] ${x.content}`).join('\n') : 'Em chưa ghi nhớ gì.';
  }
  if (cmd === 'chedo') {
    if (MODES[arg]) store.setSetting('mode', MODES[arg]);
    return 'Chế độ hiện tại: ' + MODE_VI[store.getSetting('mode') || 'auto'];
  }
  if (cmd === 'baocao') {
    const kind = REPORT_KINDS[arg || 'tuan'];
    if (!kind) return 'Anh nhắn: /baocao ngay, /baocao tuan hoặc /baocao thang';
    if (!assistantEnabled()) return DISABLED;
    return enqueue(() => makeReport(kind));
  }
  return null;
}

// Tin nhắn thường (không phải lệnh video) giao cho trợ lí.
export async function askAssistant(text, send) {
  try {
    if (isAssistantCommand(text)) {
      if (/^\/baocao\s*(ngay|tuan|thang)?\s*$/i.test(text) && assistantEnabled()) {
        await send('Em đang làm báo cáo, anh chờ em chút nhé.');
      }
      return send(await handleCommand(text));
    }
    if (!assistantEnabled()) return send(DISABLED);
    const deep = needsCouncil(text);
    if (deep) await send('Em đang làm, có GPT phản biện và Gemini duyệt, anh chờ em chút nhé.');
    return send(await enqueue(() => handleMessage(text, { deep })));
  } catch (e) {
    console.error('[assistant] lỗi', e);
    return send(`Em gặp lỗi khi xử lý (${String(e.message || e).slice(0, 200)}). Anh thử lại sau ít phút nhé.`);
  }
}

// ---------- lịch tự động (giờ Việt Nam) ----------
// Mỗi phút kiểm tra một lần. Nếu bot khởi động lại trễ thì vẫn gửi bù trong vài giờ sau giờ hẹn, không gửi trùng.
export function dueReports() {
  const n = store.nowInfo();
  const { dailyHour, weeklyHour, monthlyHour } = config.assistant;
  const out = [];
  const inWindow = (h) => n.hour >= h && n.hour < h + 4;
  if (inWindow(dailyHour) && store.getSetting('last_day_report') !== n.date) out.push('day');
  if (n.weekday === 1 && inWindow(weeklyHour) && store.getSetting('last_week_report') !== n.date) out.push('week');
  if (n.day === 1 && inWindow(monthlyHour) && store.getSetting('last_month_report') !== n.date) out.push('month');
  return out;
}

export async function runDueReports(sendToOwner) {
  for (const kind of dueReports()) {
    store.setSetting(`last_${kind}_report`, store.nowInfo().date); // đánh dấu trước, lỗi cũng không gửi lặp mỗi phút
    try {
      await sendToOwner(await enqueue(() => makeReport(kind)));
    } catch (e) {
      console.error(`[assistant] gửi báo cáo ${kind} lỗi`, e);
    }
  }
}

export function startScheduler(sendToOwner, everyMs = 60 * 1000) {
  if (!assistantEnabled()) {
    console.log('[assistant] Chưa có ANTHROPIC_API_KEY, tắt lịch báo cáo tự động.');
    return null;
  }
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runDueReports(sendToOwner);
    } finally {
      busy = false;
    }
  }, everyMs);
  timer.unref();
  return timer;
}
