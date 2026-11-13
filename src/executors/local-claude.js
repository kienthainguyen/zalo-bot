// Chạy Claude Code ngay trên VPS (chế độ không tương tác `claude -p`).
// Claude điều khiển Chrome trên VPS qua Playwright MCP (kết nối CDP tới Chrome đã đăng nhập sẵn).
// Các việc chạy lần lượt (hàng đợi), vì cùng dùng 1 Chrome.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getJob, updateJob } from '../jobs.js';
import { sendMessage } from '../zalo.js';

// Claude Code trên VPS dùng tài khoản Claude đã đăng nhập (gói của anh). Không để nó thấy các khoá API
// của Trợ lí 3 AI, nếu không nó sẽ chuyển sang tính tiền theo API key.
const HIDDEN_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'GEMINI_API_KEY'];
export function agentEnv(env = process.env) {
  const out = { ...env };
  for (const k of HIDDEN_ENV) delete out[k];
  return out;
}

const queue = [];
let running = null;

// Dừng 1 việc: bỏ khỏi hàng chờ, hoặc tắt phiên Claude đang chạy. Trả true nếu có dừng gì.
export function cancelAgent(jobId) {
  const i = queue.findIndex((q) => q.job.id === jobId);
  if (i >= 0) {
    queue.splice(i, 1);
    return true;
  }
  if (running?.job.id === jobId && running.child) {
    running.child.kill('SIGTERM');
    return true;
  }
  return false;
}

export const queueInfo = () => ({ running: running?.job.id || null, waiting: queue.map((q) => q.job.id) });

const DEFAULT_TOOLS = ['mcp__browser', 'Bash(curl:*)', 'Bash(sleep:*)'];

// promptFile: đường dẫn prompt của luồng. payload: dữ liệu của việc (JSON).
// allowedTools: công cụ Claude Code được dùng (mặc định: trình duyệt + curl + sleep).
// onExit(job, code): gọi khi phiên kết thúc; trả true nếu đã tự xử lý trường hợp Claude không báo kết quả.
export function runAgent(job, promptFile, payload, { allowedTools = DEFAULT_TOOLS, onExit } = {}) {
  const prompt =
    fs.readFileSync(promptFile, 'utf8') +
    `\n\n<job-payload>\n${JSON.stringify(payload, null, 2)}\n</job-payload>\n`;
  queue.push({ job, prompt, allowedTools, onExit });
  const position = queue.length + (running ? 1 : 0);
  setImmediate(next);
  return { position };
}

function next() {
  if (running || !queue.length) return;
  running = queue.shift();
  const { job, prompt, allowedTools, onExit } = running;
  updateJob(job.id, { status: 'running' }, 'Claude bắt đầu làm');

  const args = [
    ...config.agent.preArgs,
    '-p',
    '--output-format', 'json',
    '--mcp-config', config.agent.mcpConfig,
    '--strict-mcp-config',
    '--allowedTools', ...allowedTools,
  ];
  if (config.agent.model) args.push('--model', config.agent.model);

  fs.mkdirSync(config.agent.logDir, { recursive: true });
  const logFile = path.join(config.agent.logDir, `${job.id}.log`);
  const log = fs.createWriteStream(logFile);
  let tail = '';

  const child = (running.child = spawn(config.agent.claudeBin, args, {
    cwd: config.agent.workDir,
    env: agentEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  }));
  const keep = (d) => {
    log.write(d);
    tail = (tail + d.toString()).slice(-3000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);

  const timer = setTimeout(() => {
    keep(`\n[bot] Quá ${config.agent.timeoutMin} phút, dừng.\n`);
    child.kill('SIGTERM');
  }, config.agent.timeoutMin * 60_000);

  let finished = false;
  const finish = async (code, err) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    log.end();
    let handled = false;
    try {
      handled = Boolean(await onExit?.(getJob(job.id), err ? null : code));
    } catch (e) {
      console.error('[agent] onExit', e);
    }
    const current = getJob(job.id);
    // Nếu Claude đã tự báo done/failed/rendering qua /api/notify thì thôi; nếu chưa thì bot tự báo.
    if (!handled && current && current.status === 'running') {
      const ok = code === 0 && !err;
      const msg = ok
        ? job.workflow === 'agent_task'
          ? `Việc "${job.title}" đã chạy xong nhưng em chưa nhận được kết quả, anh nhắn em kiểm tra ạ.`
          : `Em làm xong việc "${job.title}" nhưng chưa xác nhận được kết quả, anh vào app kiểm tra giúp em ạ.`
        : `Việc "${job.title}" bị lỗi giữa chừng, anh nhắn em kiểm tra ạ.`;
      updateJob(job.id, { status: ok ? 'done' : 'failed' }, `${msg} (mã ${err ? err.message : code}, log ${logFile})`);
      await sendMessage(job.chatId, ok ? msg : `❌ ${msg}`).catch(() => {});
    }
    running = null;
    setImmediate(next);
  };
  child.on('error', (e) => finish(null, e));
  child.on('close', (code) => finish(code));
}
