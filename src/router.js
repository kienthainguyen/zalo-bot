// Nhận 1 tin nhắn, quyết định là lệnh hệ thống hay lệnh của luồng nào, rồi trả lời.
import { config } from './config.js';
import { normalize } from './text.js';
import { workflows } from './workflows/index.js';
import { createJob, updateJob, recentJobs, activeJobs } from './jobs.js';

const STATUS_VI = { queued: 'đang chờ', running: 'đang chạy', done: 'xong', failed: 'lỗi' };

function helpText() {
  const lines = ['Bot Trợ lí ra lệnh nhận các lệnh sau:'];
  for (const w of workflows) lines.push(`• ${w.title}: ví dụ "${w.examples[0]}"`);
  lines.push('• "trạng thái": xem các việc gần đây');
  lines.push('• "hướng dẫn": xem danh sách lệnh');
  return lines.join('\n');
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

  if (/^(\/)?(help|start|huong dan|lenh|menu|\?)$/.test(n)) return send(helpText());
  if (/^(\/)?(status|trang thai|tien do)\b/.test(n)) return send(statusText());

  for (const w of workflows) {
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

  return send(`Em chưa hiểu lệnh "${msg.text}".\n\n${helpText()}`);
}
