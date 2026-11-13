// Việc thực thi: trợ lí giao cho Claude Code trên VPS (có Chrome, Bash, web) làm thay anh.
// Claude báo tiến độ qua /api/notify, hỏi anh bằng status "ask", đọc câu trả lời của anh qua /api/inbox.
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { createJob, getJob, updateJob, activeJobs, allJobs } from '../jobs.js';
import { runAgent, cancelAgent } from '../executors/local-claude.js';
import { jobToken } from '../notify.js';

export const AGENT_TASK = 'agent_task';
const PROMPT = fileURLToPath(new URL('../../prompts/general.md', import.meta.url));
const TOOLS = ['mcp__browser', 'Bash', 'WebSearch', 'WebFetch', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];

// Trả về { job, position }: position > 1 nghĩa là đang xếp hàng sau việc khác.
export function startAgentTask({ title, instructions, chatId, userId }) {
  const job = createJob({
    workflow: AGENT_TASK,
    title: String(title || 'Việc thực thi').slice(0, 120),
    params: { instructions },
    chatId,
    userId,
  });
  updateJob(job.id, { inbox: [], waiting: null });
  const local = `http://127.0.0.1:${config.port}`;
  const { position } = runAgent(
    job,
    PROMPT,
    {
      workflow: AGENT_TASK,
      job_id: job.id,
      task: instructions,
      notify_url: `${local}/api/notify`,
      inbox_url: `${local}/api/inbox`,
      notify_token: jobToken(job.id),
      vnc_url: config.vncUrl,
    },
    { allowedTools: TOOLS },
  );
  return { job, position };
}

// Chuyển lời anh tới việc đang chạy (trả lời câu hỏi, bổ sung, hoặc bảo dừng).
export function answerAgentTask(jobId, message) {
  const job = getJob(jobId);
  if (!job || job.workflow !== AGENT_TASK) return null;
  if (!['queued', 'running'].includes(job.status)) return { job, closed: true };
  updateJob(job.id, { inbox: [...(job.inbox || []), String(message)], waiting: null }, `Anh trả lời: ${message}`);
  return { job, closed: false };
}

// Lấy và xoá các tin anh gửi cho việc này.
export function takeInbox(jobId) {
  const job = getJob(jobId);
  const msgs = job?.inbox || [];
  if (msgs.length) updateJob(jobId, { inbox: [] });
  return msgs;
}

export const activeAgentTasks = () => activeJobs(AGENT_TASK);

const LIVE = ['queued', 'running', 'rendering'];
// Mọi việc chưa xong trên VPS (việc thực thi, dựng video, video đang chờ app dựng).
export const liveJobs = () => allJobs().filter((j) => LIVE.includes(j.status));

// Dừng 1 việc theo lời anh. Trả về job, hoặc null nếu không có / đã kết thúc.
export function cancelJob(jobId) {
  const job = getJob(jobId);
  if (!job || !LIVE.includes(job.status)) return null;
  updateJob(job.id, { status: 'cancelled', waiting: null }, 'Anh bảo dừng');
  cancelAgent(job.id);
  return job;
}
