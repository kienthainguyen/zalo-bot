// Luồng: "Edit cho a 10 video mới về trà"
// Chọn video trà mới trong Google Photos -> đưa vào app video.kienthainguyen.com -> Dựng chuyên nghiệp.
// Việc chọn video phải thao tác trong Google Photos Picker, nên luồng này giao cho Claude Code trên VPS
// điều khiển Chrome của VPS (đã đăng nhập sẵn), rồi Claude gọi về bot để báo kết quả.
import { normalize, countBefore } from '../text.js';
import { config } from '../config.js';
import { fileURLToPath } from 'node:url';
import { runAgent } from '../executors/local-claude.js';
import { jobToken } from '../notify.js';

const PROMPT = fileURLToPath(new URL('../../prompts/edit-tea.md', import.meta.url));
const DEFAULT_COUNT = 5;
const MAX_COUNT = 30;

export default {
  id: 'edit_tea',
  title: 'Edit video trà mới',
  examples: ['Edit cho a 10 video mới về trà', 'Dựng 5 video chè'],
  // Không nhận thêm lệnh khi đang có việc cùng loại (tránh chọn trùng video).
  exclusive: true,

  match(text) {
    const n = normalize(text);
    const verb = /\b(edit|dung|lam|cat ghep)\b/.test(n);
    const topic = /\b(tra|che)\b/.test(n);
    if (!verb || !topic || !/\b(video|clip)\b/.test(n)) return null;
    const count = countBefore(n) ?? countBefore(n, 'clip') ?? DEFAULT_COUNT;
    return { count };
  },

  validate({ count }) {
    if (count < 1) return 'Số video phải từ 1 trở lên.';
    if (count > MAX_COUNT) return `Mỗi lệnh tối đa ${MAX_COUNT} video, anh chia nhỏ giúp em nhé.`;
    return null;
  },

  async start(job) {
    const local = `http://127.0.0.1:${config.port}`;
    const payload = {
      workflow: 'edit_tea',
      job_id: job.id,
      count: job.params.count,
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
        `Đã nhận: edit ${job.params.count} video trà mới (mã việc ${job.id}).${wait}\n` +
        `Em sẽ chọn video trong Google Photos và đưa vào app dựng. Mỗi video dựng khoảng 17 phút, xong em báo lại.`,
    };
  },
};
