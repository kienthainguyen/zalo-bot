// Gọi Zalo Bot Platform API: https://bot-api.zaloplatforms.com/bot<TOKEN>/<method>
import { config } from './config.js';

const BASE = 'https://bot-api.zaloplatforms.com';
const MAX_TEXT = 2000;

async function call(method, body = {}) {
  if (!config.zaloToken) throw new Error('Chưa cấu hình ZALO_BOT_TOKEN');
  const res = await fetch(`${BASE}/bot${config.zaloToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(`Zalo ${method} lỗi: ${data.error_code || res.status} ${data.description || ''}`.trim());
  }
  return data.result;
}

// Chia tin dài thành nhiều đoạn <= 2000 ký tự, ưu tiên cắt ở xuống dòng.
export function chunkText(text, max = MAX_TEXT) {
  const parts = [];
  let rest = String(text);
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) parts.push(rest);
  return parts;
}

export async function sendMessage(chatId, text) {
  for (const part of chunkText(text)) {
    await call('sendMessage', { chat_id: chatId, text: part });
  }
}

export const sendTyping = (chatId) =>
  call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

export const getMe = () => call('getMe');
export const setWebhook = (url, secretToken) => call('setWebhook', { url, secret_token: secretToken });
export const getWebhookInfo = () => call('getWebhookInfo');
export const deleteWebhook = () => call('deleteWebhook');

// Đọc tin nhắn từ payload webhook. Zalo Bot chỉ chuyển cho bot: chữ, ảnh (kèm chú thích), sticker.
// Giọng nói, video, file đến dưới dạng "message.unsupported.received" (không có nội dung).
// Trả về { kind: text | image | sticker | unsupported, text, photoUrl, ... } hoặc null.
const KINDS = {
  'message.text.received': 'text',
  'message.image.received': 'image',
  'message.sticker.received': 'sticker',
  'message.unsupported.received': 'unsupported',
};
function photoUrlOf(m) {
  const p = m.photo ?? m.photo_url ?? m.image ?? m.url;
  if (typeof p === 'string') return p;
  if (Array.isArray(p) && p.length) {
    const last = p.at(-1);
    return typeof last === 'string' ? last : last?.url || null;
  }
  return p?.url || null;
}
export function parseUpdate(payload) {
  const r = payload?.result ?? payload;
  const m = r?.message;
  const kind = KINDS[r?.event_name];
  if (!m || !kind) return null;
  if (kind === 'text' && typeof m.text !== 'string') return null;
  return {
    kind,
    chatId: m.chat?.id,
    userId: m.from?.id,
    name: m.from?.display_name || '',
    text: String((kind === 'image' ? m.caption ?? m.text : m.text) || '').trim(),
    photoUrl: kind === 'image' ? photoUrlOf(m) : null,
    messageId: m.message_id,
  };
}
