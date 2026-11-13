// Nhận 1 tin nhắn, quyết định là lệnh hệ thống hay lệnh của luồng nào, rồi trả lời.
import { config } from './config.js';
import { normalize } from './text.js';
import { workflows } from './workflows/index.js';
import { recentJobs } from './jobs.js';
import { startWorkflow } from './dispatch.js';
import { collect, combine } from './inbox.js';
import { ASSISTANT_HELP, askAssistant, isAssistantCommand } from './assistant/index.js';
import { getSetting, setSetting } from './assistant/store.js';

const STATUS_VI = { queued: 'đang chờ', running: 'đang chạy', rendering: 'app đang dựng', done: 'xong', failed: 'lỗi', cancelled: 'đã dừng' };

function helpText() {
  const lines = ['Bot Trợ lí ra lệnh nhận các lệnh sau:'];
  for (const w of workflows) lines.push(`• ${w.title}: ví dụ "${w.examples[0]}"`);
  lines.push('• "trạng thái": xem các việc dựng video gần đây');
  lines.push('• "hướng dẫn": xem danh sách lệnh');
  lines.push('', ASSISTANT_HELP);
  return lines.join('\n');
}

// Tin có dấu hiệu là trò chuyện / giao việc cho trợ lí (không phải lệnh dựng video), vd
// "lập kế hoạch dựng video trà tuần sau", "xong việc edit video trà rồi", "dựng video trà mất bao lâu?".
// Chỉ xét phần đầu câu (trước ngoặc kép, "chủ đề", "về") để chủ đề video đồ họa không bị tính.
const CHAT_MARKERS =
  /\b(ke hoach|phan tich|bao cao|de xuat|chien luoc|tong hop|danh gia|so sanh|tu van|giai phap|lo trinh|rui ro|co nen|nen khong|xong|da lam|hom qua|nhac|ghi nho|tai sao|the nao|bao lau|bao nhieu)\b/;
export function looksLikeChat(n) {
  const head = n.split(/["“”'‘’«»]|\bchu de\b|\sve\s/)[0];
  return n.length > 200 || head.includes('?') || CHAT_MARKERS.test(head);
}

function statusText() {
  const jobs = recentJobs(5);
  if (!jobs.length) return 'Chưa có việc nào.';
  return [
    'Các việc gần đây:',
    ...jobs.map((j) => {
      const last = j.log.at(-1)?.text;
      return `• ${j.id} · ${j.title} · ${STATUS_VI[j.status] || j.status}${last ? `\n  ${last}` : ''}`;
    }),
  ].join('\n');
}

const UNSUPPORTED =
  'Zalo chưa chuyển giọng nói, video và file cho bot nên em không nhận được tin vừa rồi. ' +
  'Giọng nói: anh bấm nút micro trên bàn phím điện thoại để nói thành chữ rồi gửi. ' +
  'Video, file: anh gửi link Google Drive, Google Photos hoặc YouTube, em mở bằng Chrome của VPS ạ.';

// msg: { kind, chatId, userId, name, text, photoUrl }. send(text) gửi trả lời về Zalo.
export async function handleMessage(msg, send) {
  msg = { kind: 'text', ...msg, text: msg.text || '' };
  const n = normalize(msg.text);

  // Ai cũng hỏi được id của mình, để anh thêm vào ALLOWED_ZALO_IDS.
  if (msg.kind === 'text' && /^(\/)?(id|my id|zalo id)$/.test(n)) {
    return send(`Zalo id của ${msg.name || 'bạn'}: ${msg.userId}`);
  }

  if (!config.allowedUsers.includes(msg.userId)) {
    console.warn(`[router] Tu choi user ${msg.userId} (${msg.name}): ${msg.text}`);
    return send(`Bạn chưa có quyền ra lệnh cho bot này. Zalo id của bạn là ${msg.userId}, gửi id này cho chủ bot để được thêm quyền.`);
  }

  // Nhớ chat của anh để gửi nhắc việc, báo cáo tự động.
  if (msg.userId === config.allowedUsers[0] && msg.chatId && getSetting('owner_chat_id') !== msg.chatId) {
    setSetting('owner_chat_id', msg.chatId);
  }

  if (msg.kind === 'unsupported') return send(UNSUPPORTED);
  if (msg.kind === 'text') {
    // Lệnh nhanh trả lời ngay, không gom.
    if (/^(\/)?(help|start|huong dan|lenh|menu|\?)$/.test(n)) return send(helpText());
    if (isAssistantCommand(msg.text)) return askAssistant(msg.text, send, msg);
    if (/^(\/)?(status|trang thai|tien do)\b/.test(n)) return send(statusText());
  }
  // Còn lại: gom các tin anh gửi liên tiếp, anh ngừng gửi mới xử lý.
  return collect(msg, send, flushBatch);
}

async function flushBatch(items, send, msg) {
  if (items.length === 1 && !items[0].image && !items[0].sticker) return routeText(items[0].text, send, msg);
  const { text, images } = combine(items);
  return askAssistant(text, send, msg, images);
}

// 1 tin chữ: lệnh dựng video thì chạy luồng, còn lại giao cho trợ lí.
async function routeText(text, send, msg) {
  if (!looksLikeChat(normalize(text))) {
    const r = await startWorkflow(text, msg);
    if (r.matched) return send(r.reply);
  }
  return askAssistant(text, send, msg);
}
