// Nhận 1 tin nhắn, quyết định là lệnh hệ thống hay lệnh của luồng nào, rồi trả lời.
import { config } from './config.js';
import { normalize } from './text.js';
import { workflows } from './workflows/index.js';
import { createJob, updateJob, recentJobs, activeJobs } from './jobs.js';
import { ASSISTANT_HELP, askAssistant, isAssistantCommand } from './assistant/index.js';
import { getSetting, setSetting } from './assistant/store.js';

const STATUS_VI = { queued: 'đang chờ', running: 'đang chạy', done: 'xong', failed: 'lỗi' };

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

// msg: { chatId, userId, name, text }. send(text) gửi trả lời về Zalo.
export async function handleMessage(msg, send) {
  const n = normalize(msg.text);

  // Ai cũng hỏi được id của mình, để anh thêm vào ALLOWED_ZALO_IDS.
  if (/^(\/)?(id|my id|zalo id)$/.test(n)) {
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

  if (/^(\/)?(help|start|huong dan|lenh|menu|\?)$/.test(n)) return send(helpText());
  if (isAssistantCommand(msg.text)) return askAssistant(msg.text, send, msg);
  if (/^(\/)?(status|trang thai|tien do)\b/.test(n)) return send(statusText());

  for (const w of looksLikeChat(n) ? [] : workflows) {
    const params = w.match(msg.text);
    if (!params) continue;

    const err = w.validate?.(params);
    if (err) return send(err);

    const force = /\b(van chay|cu chay|chay luon)\b/.test(n);
    if (w.exclusive && !force) {
      const busy = activeJobs(w.id);
      if (busy.length) {
        return send(
          `Đang có việc "${w.title}" chưa xong (mã ${busy[0].id}). ` +
            `Anh đợi việc đó xong, hoặc nhắn lại kèm chữ "vẫn chạy" để chạy song song.`,
        );
      }
    }

    const job = createJob({
      workflow: w.id,
      title: w.title,
      params: { ...params, rawText: msg.text },
      chatId: msg.chatId,
      userId: msg.userId,
    });
    try {
      const { reply } = await w.start(job);
      return send(reply);
    } catch (e) {
      updateJob(job.id, { status: 'failed' }, e.message);
      console.error(`[router] ${w.id} start failed`, e);
      return send(`Không bắt đầu được "${w.title}": ${e.message}`);
    }
  }

  // Không phải lệnh video: giao cho Trợ lí 3 AI.
  return askAssistant(msg.text, send, msg);
}
