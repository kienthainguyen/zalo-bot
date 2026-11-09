#!/usr/bin/env node
// Giả lập `claude -p`: đọc prompt từ stdin, lấy job-payload, ghi lại, rồi báo done về bot.
import fs from 'node:fs';
let input = '';
for await (const c of process.stdin) input += c;
const payload = JSON.parse(input.match(/<job-payload>\n([\s\S]*?)\n<\/job-payload>/)[1]);
fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), payload }) + '\n');
if (process.env.FAKE_CLAUDE_MODE === 'silent') process.exit(0);
await new Promise((r) => setTimeout(r, Number(process.env.FAKE_CLAUDE_DELAY || 0)));
await fetch(payload.notify_url, {
  method: 'POST',
  body: JSON.stringify({ job_id: payload.job_id, token: payload.notify_token, status: 'done', message: `${payload.count} video đã vào Chờ duyệt`, processed: [{ filename: 'IMG_9999.MOV' }] }),
});
