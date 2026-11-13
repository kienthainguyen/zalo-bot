// Bộ nhớ của Trợ lí 3 AI: công việc, ghi nhớ lâu dài, lịch sử trò chuyện, cài đặt.
// Lưu trong 1 file JSON (data/assistant.json), đủ cho 1 người dùng.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export const TASK_STATUSES = ['todo', 'doing', 'done', 'cancelled'];
export const PRIORITIES = ['high', 'normal', 'low'];
const STATUS_VI = { todo: 'sắp làm', doing: 'đang làm', done: 'đã xong', cancelled: 'đã huỷ' };
const MAX_MESSAGES = 3000;
export const WEEKDAYS_VI = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

// ---------- giờ Việt Nam (UTC+7, không đổi giờ mùa hè) ----------
let clock = () => new Date();
export function setClock(fn) {
  clock = fn || (() => new Date());
}
// Trả về Date "giả" mà các hàm getUTC*() cho ra giờ Việt Nam.
export function vnDate(d = clock()) {
  return new Date(d.getTime() + 7 * 3600 * 1000);
}
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (v) => `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
export function addDays(v, n) {
  return new Date(v.getTime() + n * 86400 * 1000);
}
export function nowInfo() {
  const v = vnDate();
  return {
    v,
    date: ymd(v),
    stamp: `${ymd(v)} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`,
    hour: v.getUTCHours(),
    weekday: v.getUTCDay(), // 0 = Chủ Nhật, 1 = Thứ Hai
    day: v.getUTCDate(),
    label: `${WEEKDAYS_VI[v.getUTCDay()]}, ${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`,
  };
}

// ---------- đọc / ghi file ----------
const file = () => path.join(config.dataDir, 'assistant.json');
let db = null;

function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    db = {};
  }
  db.tasks ??= [];
  db.memories ??= [];
  db.messages ??= [];
  db.settings ??= {};
  db.nextTaskId ??= db.tasks.reduce((m, t) => Math.max(m, t.id), 0) + 1;
  db.nextMemoryId ??= db.memories.reduce((m, t) => Math.max(m, t.id), 0) + 1;
  return db;
}

function save() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, file());
}

// Chỉ dùng trong kiểm thử: đọc lại từ đĩa.
export function _reset() {
  db = null;
}

// ---------- cài đặt ----------
export const getSetting = (key) => load().settings[key] ?? null;
export function setSetting(key, value) {
  load().settings[key] = value;
  save();
}

// ---------- công việc ----------
function checkDue(due) {
  if (due == null || due === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(due))) throw new Error('Hạn chót phải có dạng YYYY-MM-DD');
  return String(due);
}

export function addTask({ title, due, priority = 'normal', notes = '', status = 'todo' }) {
  load();
  title = String(title || '').trim();
  if (!title) throw new Error('Thiếu tên công việc');
  if (!TASK_STATUSES.includes(status)) throw new Error(`Trạng thái không hợp lệ: ${status}`);
  if (!PRIORITIES.includes(priority)) priority = 'normal';
  const t = nowInfo().stamp;
  const task = {
    id: db.nextTaskId++,
    title,
    status,
    priority,
    due: checkDue(due),
    notes: String(notes || ''),
    created_at: t,
    updated_at: t,
    done_at: status === 'done' ? t : null,
  };
  db.tasks.push(task);
  save();
  return task;
}

export const getTask = (id) => load().tasks.find((t) => t.id === Number(id)) || null;

export function updateTask(id, fields) {
  const task = getTask(id);
  if (!task) return null;
  const t = nowInfo().stamp;
  for (const k of ['title', 'priority', 'notes']) {
    if (fields[k] != null && fields[k] !== '') task[k] = String(fields[k]);
  }
  if (fields.due !== undefined) task.due = checkDue(fields.due);
  if (fields.status != null) {
    if (!TASK_STATUSES.includes(fields.status)) throw new Error(`Trạng thái không hợp lệ: ${fields.status}`);
    if (fields.status === 'done' && task.status !== 'done') task.done_at = t;
    if (fields.status !== 'done') task.done_at = null;
    task.status = fields.status;
  }
  task.updated_at = t;
  save();
  return task;
}

const PRI_ORDER = { high: 0, normal: 1, low: 2 };
export function listTasks(status = 'open', limit = 100) {
  const all = load().tasks;
  if (status === 'open') {
    return all
      .filter((t) => t.status === 'todo' || t.status === 'doing')
      .sort(
        (a, b) =>
          (PRI_ORDER[a.priority] ?? 1) - (PRI_ORDER[b.priority] ?? 1) ||
          (a.due ? 0 : 1) - (b.due ? 0 : 1) ||
          String(a.due).localeCompare(String(b.due)) ||
          a.id - b.id,
      )
      .slice(0, limit);
  }
  const list = status && status !== 'all' ? all.filter((t) => t.status === status) : all;
  return list.slice(-limit).reverse();
}

// start/end dạng 'YYYY-MM-DD' (end không tính).
export const tasksDoneBetween = (start, end) =>
  load()
    .tasks.filter((t) => t.status === 'done' && t.done_at && t.done_at >= start && t.done_at < end)
    .sort((a, b) => a.done_at.localeCompare(b.done_at));
export const tasksCreatedBetween = (start, end) =>
  load().tasks.filter((t) => t.created_at >= start && t.created_at < end);

export function formatTask(t) {
  let s = `#${t.id} ${t.title} [${STATUS_VI[t.status] || t.status}`;
  if (t.priority === 'high') s += ', ưu tiên cao';
  if (t.priority === 'low') s += ', ưu tiên thấp';
  if (t.due) s += `, hạn ${t.due}`;
  s += ']';
  if (t.status === 'done' && t.done_at) s += ` xong lúc ${t.done_at}`;
  if (t.notes) s += ` (${t.notes})`;
  return s;
}

// ---------- ghi nhớ ----------
export function addMemory(content) {
  load();
  const m = { id: db.nextMemoryId++, content: String(content).trim(), created_at: nowInfo().stamp };
  db.memories.push(m);
  save();
  return m;
}
export function deleteMemory(id) {
  load();
  const i = db.memories.findIndex((m) => m.id === Number(id));
  if (i < 0) return false;
  db.memories.splice(i, 1);
  save();
  return true;
}
export const listMemories = () => load().memories;

// ---------- lịch sử trò chuyện ----------
export function addMessage(role, content) {
  load();
  db.messages.push({ role, content: String(content), created_at: nowInfo().stamp });
  if (db.messages.length > MAX_MESSAGES) db.messages.splice(0, db.messages.length - MAX_MESSAGES);
  save();
}
export const recentMessages = (n = 16) => load().messages.slice(-n);
export const messagesBetween = (start, end) =>
  load().messages.filter((m) => m.created_at >= start && m.created_at < end);
