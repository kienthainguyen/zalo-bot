// Luồng: "Dựng cho a 3 video đồ họa giải thích về chủ đề "AI chốt sale tự động""
// Mở app video.kienthainguyen.com -> "Đồ họa giải thích" -> mỗi video một kịch bản khác nhau theo chủ đề -> dựng.
// Claude Code trên VPS điều khiển Chrome của VPS rồi báo kết quả về bot.
import { fileURLToPath } from 'node:url';
import { normalize, countBefore } from '../text.js';
import { config } from '../config.js';
import { runAgent } from '../executors/local-claude.js';
import { jobToken } from '../notify.js';

const PROMPT = fileURLToPath(new URL('../../prompts/explainer.md', import.meta.url));
const DEFAULT_COUNT = 3;
const MAX_COUNT = 10;

// Lấy chủ đề từ lệnh gốc (giữ nguyên dấu): ưu tiên phần trong ngoặc kép, sau đó phần sau "chủ đề"/"về".
export function extractTopic(text) {
  const quoted = text.match(/["“”'‘’«]([^"“”'‘’»]{2,200})["“”'‘’»]/);
  if (quoted) return quoted[1].trim();
  for (const re of [/(?:^|\s)(?:chủ\s*đề|chu\s*de)\s*[:\-]?\s*(.{2,200})$/i, /(?:^|\s)(?:về|ve)\s*[:\-]?\s*(.{2,200})$/i]) {
    const m = text.match(re);
    if (m) return m[1].trim().replace(/[.!?]+$/, '');
  }
  return null;
}

export default {
  id: 'explainer',
  title: 'Dựng video đồ họa giải thích theo chủ đề',
  examples: ['Dựng cho a 3 video đồ họa giải thích về chủ đề "AI chốt sale tự động"'],
  exclusive: false,

  match(text) {
    const n = normalize(text);
    if (!/\bdo hoa\b/.test(n)) return null;
    if (!/\b(dung|lam|tao|edit|ra)\b/.test(n)) return null;
    const count = countBefore(n) ?? DEFAULT_COUNT;
    return { count, topic: extractTopic(text) };
  },

  validate({ count, topic }) {
    if (!topic) return 'Anh ghi rõ chủ đề trong ngoặc kép giúp em, ví dụ: dựng 3 video đồ họa giải thích về chủ đề "AI chốt sale tự động".';
    if (count < 1) return 'Số video phải từ 1 trở lên.';
    if (count > MAX_COUNT) return `Mỗi lệnh tối đa ${MAX_COUNT} video đồ họa, anh chia nhỏ giúp em nhé.`;
    return null;
  },

  async start(job) {
    const local = `http://127.0.0.1:${config.port}`;
    const payload = {
      workflow: 'explainer',
      job_id: job.id,
      count: job.params.count,
      topic: job.params.topic,
      requested_text: job.params.rawText,
      notify_url: `${local}/api/notify`,
      processed_url: `${local}/api/processed`,
      notify_token: jobToken(job.id),
      vnc_url: config.vncUrl,
    };
    const { position } = runAgent(job, PROMPT, payload);
    const wait = position > 1 ? ` Đang có ${position - 1} việc trước, em làm lần lượt.` : '';
    return {
      reply:
        `Đã nhận: dựng ${job.params.count} video đồ họa giải thích về "${job.params.topic}" (mã việc ${job.id}).${wait}\n` +
        `Em sẽ viết ${job.params.count} kịch bản khác nhau rồi đưa vào app dựng, xong em báo lại.`,
    };
  },
};
