// Chạy lệnh dựng video (các luồng trong src/workflows/) từ 1 câu lệnh. Dùng chung cho router và trợ lí.
import { normalize } from './text.js';
import { workflows } from './workflows/index.js';
import { createJob, updateJob, activeJobs } from './jobs.js';

// Trả về { matched: false } nếu câu không phải lệnh video, hoặc { matched: true, reply }.
export async function startWorkflow(text, msg) {
  const n = normalize(text);
  for (const w of workflows) {
    const params = w.match(text);
    if (!params) continue;

    const err = w.validate?.(params);
    if (err) return { matched: true, reply: err };

    const force = /\b(van chay|cu chay|chay luon)\b/.test(n);
    if (w.exclusive && !force) {
      const busy = activeJobs(w.id);
      if (busy.length) {
        return {
          matched: true,
          reply:
            `Đang có việc "${w.title}" chưa xong (mã ${busy[0].id}). ` +
            `Anh đợi việc đó xong, hoặc nhắn lại kèm chữ "vẫn chạy" để chạy song song.`,
        };
      }
    }

    const job = createJob({ workflow: w.id, title: w.title, params: { ...params, rawText: text }, chatId: msg.chatId, userId: msg.userId });
    try {
      const { reply } = await w.start(job);
      return { matched: true, reply, job };
    } catch (e) {
      updateJob(job.id, { status: 'failed' }, e.message);
      console.error(`[dispatch] ${w.id} start failed`, e);
      return { matched: true, reply: `Không bắt đầu được "${w.title}": ${e.message}` };
    }
  }
  return { matched: false };
}
