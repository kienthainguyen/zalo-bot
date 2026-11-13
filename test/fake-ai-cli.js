#!/usr/bin/env node
// Giả lập 3 công cụ dòng lệnh: `claude -p`, `codex exec`, `gemini -p`. Ghi lại tham số vào FAKE_AI_LOG.
import fs from 'node:fs';
const argv = process.argv.slice(2);
let input = '';
for await (const c of process.stdin) input += c;
const kind = argv.includes('exec') ? 'codex' : argv.includes('--approval-mode') ? 'gemini' : 'claude';
fs.appendFileSync(process.env.FAKE_AI_LOG, JSON.stringify({ kind, argv, input }) + '\n');

if (kind === 'codex') {
  fs.writeFileSync(argv[argv.indexOf('-o') + 1], process.env.FAKE_GPT || 'KHÔNG CÓ VẤN ĐỀ');
} else if (kind === 'gemini') {
  process.stdout.write('```json\n{"verdict":"revise","reason":"Thiếu ngân sách.","instructions":"Thêm ngân sách"}\n```');
} else {
  const system = argv[argv.indexOf('--append-system-prompt') + 1];
  const m = system.match(/curl -sS -X POST (\S+) [\s\S]*?"session":"([^"]+)","token":"([^"]+)"/);
  let result = 'Bản sửa có ngân sách';
  if (m) {
    const r = await fetch(m[1], { method: 'POST', body: JSON.stringify({ session: m[2], token: m[3], name: 'add_task', input: { title: 'Gọi khách A', due: '2026-11-14' } }) });
    result = `Dạ em đã ghi (${(await r.json()).result})`;
  }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result }));
}
