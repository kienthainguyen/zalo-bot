// Theo dõi video đang dựng trên app (app chạy ở VPS khác).
// Phiên Claude dựng video bấm dựng xong thì báo status "rendering" kèm danh sách `watch` rồi thoát, để Chrome rảnh.
// Bot tự mở phiên kiểm tra ngắn (prompts/check-videos.md) mỗi VIDEO_CHECK_MIN phút, tới khi video vào Chờ duyệt.
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { allJobs, updateJob } from './jobs.js';
import { runAgent } from './executors/local-claude.js';
import { jobToken } from './notify.js';
import { sendMessage } from './zalo.js';

const PROMPT = fileURLToPath(new URL('../prompts/check-videos.md', import.meta.url));
const MAX_MIN = { edit_tea: 300, explainer: 180 }; // quá thời gian này thì kiểm tra lần cuối
const MAX_FAILED_CHECKS = 3;
const inFlight = new Set();

const minutes = (n) => n * 60_000;

// Gọi từ /api/notify khi nhận status "rendering".
export function markRendering(job, body, message) {
  const first = job.status !== 'rendering' && !job.renderSince;
  const note = first ? (message.match(/Em chỉ tìm được[^.]*\./) || [''])[0] : job.renderNote;
  return updateJob(
    job.id,
    {
      status: 'rendering',
      watch: Array.isArray(body.watch) && body.watch.length ? body.watch.slice(0, 50) : job.watch || [],
      retried: Array.isArray(body.retried) ? body.retried.slice(0, 50) : job.retried || [],
      renderNote: note || '',
      renderSince: job.renderSince || Date.now(),
      nextCheckAt: Date.now() + minutes(config.videoCheckMin),
      checkFailures: 0,
    },
    message || 'Đã đưa video vào dựng',
  );
}

function startCheck(job) {
  inFlight.add(job.id);
  const local = `http://127.0.0.1:${config.port}`;
  const final = Date.now() - job.renderSince >= minutes(MAX_MIN[job.workflow] || 300);
  runAgent(
    job,
    PROMPT,
    {
      job_id: job.id,
      workflow: job.workflow,
      count: job.params?.count,
      watch: job.watch || [],
      note: job.renderNote || '',
      retried: job.retried || [],
      final,
      notify_url: `${local}/api/notify`,
      notify_token: jobToken(job.id),
      vnc_url: config.vncUrl,
    },
    {
      onExit: async (cur) => {
        inFlight.delete(job.id);
        if (!cur || cur.status !== 'running') return false; // đã báo rendering / done / failed
        // Phiên kiểm tra thoát mà không báo gì: thử lại lần sau, quá 3 lần thì báo anh.
        const fails = (cur.checkFailures || 0) + 1;
        if (fails < MAX_FAILED_CHECKS) {
          updateJob(cur.id, { status: 'rendering', checkFailures: fails, nextCheckAt: Date.now() + minutes(config.videoCheckMin) }, 'Phiên kiểm tra không báo kết quả, thử lại sau');
          return true;
        }
        const msg = 'Video đã được đưa vào dựng nhưng em chưa kiểm tra được kết quả, anh vào app xem giúp em ạ.';
        updateJob(cur.id, { status: 'failed' }, msg);
        await sendMessage(cur.chatId, msg).catch(() => {});
        return true;
      },
    },
  );
}

export function checkDue(now = Date.now()) {
  for (const job of allJobs()) {
    if (job.status === 'rendering' && !inFlight.has(job.id) && (job.nextCheckAt || 0) <= now) startCheck(job);
  }
}

export function startWatcher(everyMs = 60_000) {
  // Bot khởi động lại giữa lúc đang kiểm tra: đưa việc về trạng thái chờ kiểm tra tiếp.
  for (const job of allJobs()) {
    if (['running', 'queued'].includes(job.status) && job.renderSince) {
      updateJob(job.id, { status: 'rendering', nextCheckAt: Date.now() }, 'Bot khởi động lại, kiểm tra tiếp');
    }
  }
  const t = setInterval(checkDue, everyMs);
  t.unref();
  return t;
}
