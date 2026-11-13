// Ba bộ não: Claude (làm việc), GPT (phản biện), Gemini (trọng tài).
// Mặc định dùng GÓI ĐĂNG KÝ của anh qua công cụ dòng lệnh chính hãng đã đăng nhập trên VPS:
//   Claude Max -> `claude -p`, ChatGPT Plus -> `codex exec`, Google AI Pro -> `gemini -p`.
// Nếu .env có khoá API (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY) thì AI đó dùng API thay vì gói.
// Kiểm thử thay các hàm trong object `ai` bằng hàm giả.
import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { agentEnv } from '../executors/local-claude.js';

// Chạy 1 lệnh, đưa `input` vào stdin, trả về stdout. Lỗi nếu mã thoát khác 0 hoặc quá giờ.
export function runCli(bin, args, input, { timeoutMs = 10 * 60_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: cwd || os.tmpdir(), env: agentEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Không chạy được ${path.basename(bin)}: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(bin)} thoát mã ${code}: ${(err || out).trim().slice(-300)}`));
    });
  });
}

// Thư mục chạy các công cụ AI: để NGOÀI thư mục bot, vì Gemini CLI tự đọc file .env ở thư mục hiện tại
// và các thư mục cha (sẽ lấy nhầm khoá API thay vì đăng nhập Google).
function workDir() {
  const d = process.env.AI_WORK_DIR || path.join(os.homedir(), '.zalo-bot-ai');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const systemText = (system) => (Array.isArray(system) ? system.map((b) => b.text).join('\n\n') : String(system || ''));

// Claude Code (gói Claude Max). allowedTools rỗng = chỉ trả lời chữ.
async function claudeCli(system, prompt, { allowedTools = [] } = {}) {
  const c = config.assistant.cli;
  const args = [...config.agent.preArgs, '-p', '--output-format', 'json', '--strict-mcp-config', '--append-system-prompt', system];
  if (c.claudeModel) args.push('--model', c.claudeModel);
  if (allowedTools.length) args.push('--allowedTools', ...allowedTools);
  const out = await runCli(config.agent.claudeBin, args, prompt, { cwd: workDir() });
  let r;
  try {
    r = JSON.parse(out);
  } catch {
    throw new Error('Claude trả kết quả không đọc được');
  }
  if (r.is_error) throw new Error(`Claude lỗi: ${String(r.result || r.subtype).slice(0, 200)}`);
  return String(r.result || '').trim();
}

// Codex CLI (gói ChatGPT Plus).
async function codexCli(system, prompt) {
  const c = config.assistant.cli;
  const outFile = path.join(workDir(), `codex-${crypto.randomBytes(6).toString('hex')}.txt`);
  const args = [...c.codexPreArgs, 'exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-C', workDir(), '-o', outFile];
  if (c.openaiModel) args.push('-m', c.openaiModel);
  args.push('-');
  try {
    await runCli(c.codexBin, args, `${system}\n\n${prompt}`, { cwd: workDir() });
    return fs.readFileSync(outFile, 'utf8').trim();
  } finally {
    fs.rmSync(outFile, { force: true });
  }
}

// Gemini CLI (gói Google AI Pro), chế độ chỉ đọc.
async function geminiCli(system, prompt) {
  const c = config.assistant.cli;
  const args = [...c.geminiPreArgs, '-o', 'text', '--approval-mode', 'plan'];
  if (c.geminiModel) args.push('-m', c.geminiModel);
  args.push('-p', 'Làm theo yêu cầu ở trên. Chỉ trả về đúng 1 khối JSON, không thêm chữ nào khác.');
  return runCli(c.geminiBin, args, `${system}\n\n${prompt}`, { cwd: workDir() });
}

let client = null;
function anthropic() {
  if (!config.assistant.anthropicKey) throw new Error('Thiếu ANTHROPIC_API_KEY trong .env');
  client ??= new Anthropic({ apiKey: config.assistant.anthropicKey, maxRetries: 3 });
  return client;
}

async function postJson(url, headers, body, label) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${label} lỗi ${res.status}: ${data?.error?.message || ''}`.trim());
  return data;
}

// Lấy chữ trong kết quả Claude (bỏ qua khối thinking, tool_use...).
export function claudeTextOf(message) {
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

// Tìm và đọc khối JSON đầu tiên trong chuỗi; trả {} nếu không đọc được.
export function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  try {
    const v = JSON.parse(m ? m[0] : text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export const ai = {
  // Gọi Messages API, trả về Message của SDK.
  async claude(params) {
    return anthropic().messages.create({ model: config.assistant.claudeModel, ...params });
  },

  // Claude Code có công cụ (curl về bot, tìm kiếm web), dùng gói Claude Max. Trả về chữ trả lời.
  async claudeAgent(system, prompt, allowedTools) {
    return claudeCli(system, prompt, { allowedTools });
  },

  // Claude 1 lượt, không công cụ.
  async claudeText(system, prompt, { maxTokens = 8000, effort = 'medium' } = {}) {
    if (!config.assistant.anthropicKey) return claudeCli(systemText(system), prompt);
    const msg = await ai.claude({
      max_tokens: maxTokens,
      system,
      output_config: { effort },
      messages: [{ role: 'user', content: prompt }],
    });
    if (msg.stop_reason === 'refusal') return '';
    return claudeTextOf(msg);
  },

  // GPT phản biện (OpenAI Responses API).
  async gptText(system, prompt) {
    const key = config.assistant.openaiKey;
    if (!key) return codexCli(system, prompt);
    const data = await postJson(
      'https://api.openai.com/v1/responses',
      { Authorization: `Bearer ${key}` },
      { model: config.assistant.openaiModel, instructions: system, input: prompt },
      'OpenAI',
    );
    if (typeof data.output_text === 'string') return data.output_text.trim();
    return (data.output || [])
      .filter((o) => o.type === 'message')
      .flatMap((o) => o.content || [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text)
      .join('')
      .trim();
  },

  // Gemini trọng tài, trả về object JSON.
  async geminiJson(system, prompt) {
    const key = config.assistant.geminiKey;
    if (!key) return parseJson(await geminiCli(system, prompt));
    const model = encodeURIComponent(config.assistant.geminiModel);
    const data = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { 'x-goog-api-key': key },
      {
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      },
      'Gemini',
    );
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    return parseJson(text);
  },
};
