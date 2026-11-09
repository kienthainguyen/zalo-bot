// Phiên Claude gọi POST /api/notify để báo tiến độ / kết quả về Zalo.
// Mỗi việc có token riêng = HMAC(NOTIFY_SECRET, job_id), nên token lộ cũng chỉ ảnh hưởng 1 việc.
import crypto from 'node:crypto';
import { config } from './config.js';

export function jobToken(jobId) {
  if (!config.notifySecret) throw new Error('Chưa cấu hình NOTIFY_SECRET');
  return crypto.createHmac('sha256', config.notifySecret).update(jobId).digest('hex').slice(0, 32);
}

export function checkJobToken(jobId, token) {
  if (!jobId || typeof token !== 'string') return false;
  const want = Buffer.from(jobToken(jobId));
  const got = Buffer.from(token);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
