// Chạy Claude Code ngay trên VPS (chế độ không tương tác `claude -p`).
// Claude điều khiển Chrome trên VPS qua Playwright MCP (kết nối CDP tới Chrome đã đăng nhập sẵn).
// Các việc chạy lần lượt (hàng đợi), vì cùng dùng 1 Chrome.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getJob, updateJob } from '../jobs.js';
import { sendMessage } from '../zalo.js';

const queue = [];
let running = null;

export const queueInfo = () => ({ running: running?.job.id || null, waiting: queue.map((q) => q.job.id) });

// promptFile: đường dẫn prompt của luồng. payload: dữ liệu của việc (JSON).
export function runAgent(job, promptFile, payload) {
  const prompt =
    fs.readFileSync(promptFile, 'utf8') +
    `\n\n<job-payload>\n${JSON.stringify(payload, null, 2)}\n</job-payload>\n`;
  queue.push({ job, prompt });
  const position = queue.length + (running ? 1 : 0);
  setImmediate(next);
  return { position };
}

function next() {
  if (running || !queue.length) return;
  running = queue.shift();
  const { job, prompt } = running;
  updateJob(job.id, { status: 'running' }, 'Claude bắt đầu làm');

  const args = [
    ...config.agent.preArgs,
    '-p',
    '--output-format', 'json',
    '--mcp-config', config.agent.mcpConfig,
    '--strict-mcp-config',
    '--allowedTools', 'mcp__browser', 'Bash(curl:*)', 'Bash(sleep:*)',
  ];
  if (config.agent.model) args.push('--model', config.agent.model);

  fs.mkdirSync(config.agent.logDir, { recursive: true });
  const logFile = path.join(config.agent.logDir, `${job.id}.log`);
  const log = fs.createWriteStream(logFile);
  let tail = '';

  const child = spawn(config.agent.claudeBin, args, {
    cwd: config.agent.workDir,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
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
    const current = getJob(job.id);
    // Nếu Claude đã tự báo done/failed qua /api/notify thì thôi; nếu chưa thì bot tự báo.
    if (current && current.status === 'running') {
      const ok = code === 0 && !err;
      const msg = ok
        ? `Em làm xong việc "${job.title}" nhưng chưa xác nhận được kết quả, anh vào app kiểm tra giúp em ạ.`
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
