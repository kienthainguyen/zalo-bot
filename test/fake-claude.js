#!/usr/bin/env node
// Giả lập `claude -p`: đọc prompt từ stdin, lấy job-payload, ghi lại, rồi báo done về bot.
import fs from 'node:fs';
let input = '';
for await (const c of process.stdin) input += c;
const payload = JSON.parse(input.match(/<job-payload>\n([\s\S]*?)\n<\/job-payload>/)[1]);
fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), payload }) + '\n');
if (process.env.FAKE_CLAUDE_MODE === 'silent') process.exit(0);
await new Promise((r) => setTimeout(r, Number(process.env.FAKE_CLAUDE_DELAY || 0)));
const notify = (status, message) =>
  fetch(payload.notify_url, { method: 'POST', body: JSON.stringify({ job_id: payload.job_id, token: payload.notify_token, status, message }) });

if (payload.workflow === 'agent_task') {
  // Việc thực thi: hỏi anh 1 lần (đăng nhập), chờ câu trả lời trong inbox, rồi báo xong.
  await notify('ask', `Anh mở ${payload.vnc_url} đăng nhập Facebook giúp em, xong nhắn em 'xong' ạ.`);
  let answer;
  for (let i = 0; i < 200 && !answer; i++) {
    await new Promise((r) => setTimeout(r, 25));
    const r = await (await fetch(`${payload.inbox_url}?job_id=${payload.job_id}&token=${payload.notify_token}`)).json();
    answer = r.messages[0];
  }
  await notify('done', `Đã tạo fanpage Trà Kiên Thái Nguyên (anh trả lời: ${answer}).`);
  process.exit(0);
}
await fetch(payload.notify_url, {
  method: 'POST',
  body: JSON.stringify({ job_id: payload.job_id, token: payload.notify_token, status: 'running', message: 'đang chọn video (chỉ ghi log)' }),
});
await fetch(payload.notify_url, {
  method: 'POST',
  body: JSON.stringify({ job_id: payload.job_id, token: payload.notify_token, status: 'done', message: `${payload.count} video đã xong, hiện nằm trong phần Chờ duyệt, anh vào kiểm tra ạ.`, processed: [{ filename: 'IMG_9999.MOV' }] }),
});
