// Gom tin nhắn: anh có thể gửi nhiều tin liên tiếp (chữ, ảnh, sticker). Bot đợi anh ngừng gửi
// BATCH_WAIT_MS (mặc định 10 giây) rồi mới xử lý cả loạt một lần.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { workDir } from './assistant/ai.js';

const pending = new Map(); // chatId -> { items, timer, send, msg }
const MAX_IMAGE = 15 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

// Tải ảnh Zalo về thư mục inbox (Claude chỉ được đọc trong thư mục này). Trả { path, rel, mediaType } hoặc null.
export async function downloadImage(url, id) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE) throw new Error('ảnh quá lớn');
    let mediaType = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!EXT[mediaType]) mediaType = buf[0] === 0x89 ? 'image/png' : 'image/jpeg';
    const dir = path.join(workDir(), 'inbox');
    fs.mkdirSync(dir, { recursive: true });
    cleanup(dir);
    const name = `${String(id || Date.now()).replace(/[^\w-]/g, '')}.${EXT[mediaType]}`;
    const file = path.join(dir, name);
    fs.writeFileSync(file, buf);
    return { path: file, rel: `./inbox/${name}`, mediaType };
  } catch (e) {
    console.error('[inbox] tải ảnh lỗi', e.message);
    return null;
  }
}

// Xoá ảnh cũ hơn 7 ngày.
function cleanup(dir) {
  const old = Date.now() - 7 * 86400_000;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try {
      if (fs.statSync(p).mtimeMs < old) fs.rmSync(p);
    } catch {}
  }
}

// Thêm 1 tin vào loạt đang gom. flush(items, send, msg) được gọi khi anh ngừng gửi.
// item: { text, image: Promise<{path,rel,mediaType}|null> | null, sticker }
export function collect(msg, send, flush) {
  const key = msg.chatId;
  let p = pending.get(key);
  if (!p) {
    p = { items: [] };
    p.done = new Promise((resolve) => (p.resolve = resolve));
  }
  clearTimeout(p.timer);
  p.items.push({
    text: msg.text,
    sticker: msg.kind === 'sticker',
    image: msg.kind === 'image' && msg.photoUrl ? downloadImage(msg.photoUrl, msg.messageId) : null,
  });
  p.send = send;
  p.msg = msg;
  p.timer = setTimeout(async () => {
    pending.delete(key);
    const items = await Promise.all(p.items.map(async (i) => ({ ...i, image: i.image ? await i.image : null })));
    try {
      await flush(items, p.send, p.msg);
    } catch (e) {
      console.error('[inbox] xử lý lỗi', e);
      await p.send(`Em gặp lỗi khi xử lý (${String(e.message).slice(0, 200)}). Anh thử lại sau ít phút nhé.`).catch(() => {});
    }
    p.resolve();
  }, config.batchWaitMs);
  pending.set(key, p);
  return p.done; // xong khi cả loạt đã xử lý
}

// Ghép loạt tin thành 1 yêu cầu cho trợ lí.
export function combine(items) {
  const images = [];
  const lines = items.map((i, k) => {
    const parts = [];
    if (i.image) {
      images.push(i.image);
      parts.push(`[ảnh ${images.length}: ${i.image.rel}]`);
    } else if (i.sticker) parts.push('[sticker]');
    if (i.text) parts.push(i.text);
    if (!i.image && !i.sticker && !i.text) parts.push('[ảnh không tải được]');
    return items.length > 1 ? `${k + 1}. ${parts.join(' ')}` : parts.join(' ');
  });
  const text = items.length > 1 ? `Anh gửi ${items.length} tin liên tiếp:\n${lines.join('\n')}` : lines[0];
  return { text, images };
}

export const pendingBatches = () => pending.size;
