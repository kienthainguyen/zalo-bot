// Chạy 1 lần sau khi VPS có HTTPS: npm run set-webhook
// Đăng ký địa chỉ PUBLIC_URL/zalo/webhook với Zalo và kiểm tra token bot.
import { config } from '../src/config.js';
import { getMe, setWebhook, getWebhookInfo, webhookUrl } from '../src/zalo.js';

if (!config.publicUrl.startsWith('https://')) {
  console.error('PUBLIC_URL phải là https://... (Zalo bắt buộc HTTPS)');
  process.exit(1);
}
if (config.zaloWebhookSecret.length < 8) {
  console.error('ZALO_WEBHOOK_SECRET phải dài 8-256 ký tự');
  process.exit(1);
}

for (const bot of config.zaloBot2Token ? [1, 2] : [1]) {
  const me = await getMe(bot);
  console.log(`Bot ${bot}:`, me.account_name, me.id);
  const r = await setWebhook(webhookUrl(bot), config.zaloWebhookSecret, bot);
  console.log('setWebhook:', JSON.stringify(r, null, 2));
  console.log('getWebhookInfo:', JSON.stringify(await getWebhookInfo(bot), null, 2));
}
