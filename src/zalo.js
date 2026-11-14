// Gọi Zalo Bot Platform API: https://bot-api.zaloplatforms.com/bot<TOKEN>/<method>
import { config } from './config.js';

const BASE = 'https://bot-api.zaloplatforms.com';
const MAX_TEXT = 2000;

// Tin đến từ bot thứ 2 mang chatId dạng "b2:<id>", nhờ vậy việc, nhắc giờ, báo kết quả... tự gửi về đúng bot.
export const BOT2_PREFIX = 'b2:';
function route(chatId) {
  const s = String(chatId);
  if (s.startsWith(BOT2_PREFIX)) return { bot: 2, id: s.slice(BOT2_PREFIX.length) };
  return { bot: 1, id: s };
}
const tokenOf = (bot) => (bot === 2 ? config.zaloBot2Token : config.zaloToken);

async function call(method, body = {}, bot = 1) {
  const token = tokenOf(bot);
  if (!token) throw new Error(bot === 2 ? 'Chưa cấu hình ZALO_BOT2_TOKEN' : 'Chưa cấu hình ZALO_BOT_TOKEN');
  const res = await fetch(`${BASE}/bot${token}/${method}`, {
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
  const { bot, id } = route(chatId);
  for (const part of chunkText(text)) {
    await call('sendMessage', { chat_id: id, text: part }, bot);
  }
}

export const sendTyping = (chatId) => {
  const { bot, id } = route(chatId);
  return call('sendChatAction', { chat_id: id, action: 'typing' }, bot).catch(() => {});
};

export const getMe = (bot = 1) => call('getMe', {}, bot);
export const setWebhook = (url, secretToken, bot = 1) => call('setWebhook', { url, secret_token: secretToken }, bot);
export const getWebhookInfo = (bot = 1) => call('getWebhookInfo', {}, bot);
export const deleteWebhook = (bot = 1) => call('deleteWebhook', {}, bot);

// Địa chỉ webhook của từng bot: bot 2 dùng chung đường dẫn, thêm ?bot=2.
export const webhookUrl = (bot = 1) => `${config.publicUrl}/zalo/webhook${bot === 2 ? '?bot=2' : ''}`;

// Bot 2: khi khởi động, nếu Zalo chưa trỏ về đây thì tự đăng ký webhook (anh chỉ cần điền token vào .env).
export async function ensureBot2Webhook() {
  if (!config.zaloBot2Token || !config.publicUrl.startsWith('https://') || config.zaloWebhookSecret.length < 8) return;
  try {
    const info = await getWebhookInfo(2).catch(() => null);
    if (info?.url === webhookUrl(2)) return;
    await setWebhook(webhookUrl(2), config.zaloWebhookSecret, 2);
    console.log('[zalo] Đã trỏ webhook bot 2 về', webhookUrl(2));
  } catch (e) {
    console.error('[zalo] Không đăng ký được webhook bot 2:', e.message);
  }
}

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
export function parseUpdate(payload, bot = 1) {
  const r = payload?.result ?? payload;
  const m = r?.message;
  const kind = KINDS[r?.event_name];
  if (!m || !kind) return null;
  if (kind === 'text' && typeof m.text !== 'string') return null;
  return {
    kind,
    chatId: m.chat?.id == null ? m.chat?.id : bot === 2 ? `${BOT2_PREFIX}${m.chat.id}` : m.chat.id,
    userId: m.from?.id,
    name: m.from?.display_name || '',
    text: String((kind === 'image' ? m.caption ?? m.text : m.text) || '').trim(),
    photoUrl: kind === 'image' ? photoUrlOf(m) : null,
    messageId: m.message_id,
  };
}
