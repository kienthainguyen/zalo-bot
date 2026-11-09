// Đọc cấu hình từ biến môi trường (file .env).
import path from 'node:path';
function list(name) {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '127.0.0.1', // chỉ nghe nội bộ, Caddy đứng trước
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  dataDir: process.env.DATA_DIR || './data',

  // Zalo Bot Platform
  zaloToken: process.env.ZALO_BOT_TOKEN || '',
  zaloWebhookSecret: process.env.ZALO_WEBHOOK_SECRET || '',
  // Zalo user id được phép ra lệnh. Để trống = chưa ai được phép (bot sẽ báo id cho người nhắn).
  allowedUsers: list('ALLOWED_ZALO_IDS'),

  // Khóa để phiên Claude gọi ngược về báo tiến độ / kết quả.
  notifySecret: process.env.NOTIFY_SECRET || '',

  // Địa chỉ trang noVNC để anh đăng nhập lại Chrome trên VPS khi cần.
  vncUrl: process.env.VNC_URL || '',

  // Claude Code chạy trên VPS, điều khiển Chrome qua Playwright MCP.
  agent: {
    claudeBin: process.env.CLAUDE_BIN || 'claude',
    preArgs: list('CLAUDE_PRE_ARGS'), // chỉ dùng khi kiểm thử
    // Đường dẫn tuyệt đối: Claude chạy trong thư mục agent/, nên đường dẫn tương đối sẽ sai.
    mcpConfig: path.resolve(process.env.AGENT_MCP_CONFIG || './agent/mcp.json'),
    workDir: path.resolve(process.env.AGENT_WORKDIR || './agent'),
    logDir: path.resolve(process.env.AGENT_LOG_DIR || `${process.env.DATA_DIR || './data'}/logs`),
    model: process.env.AGENT_MODEL || '',
    timeoutMin: Number(process.env.AGENT_TIMEOUT_MIN || 360), // gồm cả thời gian chờ app dựng xong
  },
};
