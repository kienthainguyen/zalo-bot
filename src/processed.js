// Danh sách mục đã làm của từng luồng (vd video trà đã dựng), để lần sau bỏ qua.
// Lần đầu chạy sẽ nạp sẵn từ seed/processed.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const file = () => path.join(config.dataDir, 'processed.json');
const seedFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'processed.json');

function load() {
  for (const f of [file(), seedFile]) {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {}
  }
  return {};
}

export function listProcessed(workflow) {
  return load()[workflow] || [];
}

export function addProcessed(workflow, jobId, items) {
  const all = load();
  const list = (all[workflow] ||= []);
  const at = new Date().toISOString();
  for (const it of items.slice(0, 100)) {
    if (!it || typeof it !== 'object') continue;
    list.push({ ...it, job_id: jobId, at });
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file() + '.tmp', JSON.stringify(all, null, 2));
  fs.renameSync(file() + '.tmp', file());
}
