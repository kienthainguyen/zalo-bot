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
  // Bot Zalo thứ 2 (vd bot báo cáo của app dựng video) cũng làm trợ lí y hệt. Để trống = chỉ 1 bot.
  zaloBot2Token: process.env.ZALO_BOT2_TOKEN || '',
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

  // Gom tin: đợi anh ngừng gửi bấy nhiêu mili giây rồi mới xử lý cả loạt.
  batchWaitMs: Number(process.env.BATCH_WAIT_MS ?? 10_000),

  // Bot mở phiên kiểm tra video đang dựng trên app mỗi bao nhiêu phút.
  videoCheckMin: Number(process.env.VIDEO_CHECK_MIN || 10),

  // Trợ lí 3 AI: Claude làm, GPT phản biện, Gemini trọng tài.
  assistant: {
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    openaiKey: process.env.OPENAI_API_KEY || '',
    geminiKey: process.env.GEMINI_API_KEY || '',
    claudeModel: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-5',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
    webSearch: (process.env.ASSISTANT_WEB_SEARCH || '1') === '1',
    // Dùng gói đăng ký qua công cụ dòng lệnh (khi không có khoá API tương ứng).
    cli: {
      claudeModel: process.env.CLAUDE_MODEL || '', // để trống = mặc định của Claude Code
      codexBin: process.env.CODEX_BIN || 'codex',
      codexPreArgs: list('CODEX_PRE_ARGS'), // chỉ dùng khi kiểm thử
      openaiModel: process.env.OPENAI_MODEL || '',
      geminiBin: process.env.GEMINI_BIN || 'gemini',
      geminiPreArgs: list('GEMINI_PRE_ARGS'),
      geminiModel: process.env.GEMINI_MODEL || '',
      // Gemini CLI không đăng nhập được bằng tài khoản cá nhân nữa: mặc định tắt. GEMINI_CLI=1 để bật lại.
      gemini: process.env.GEMINI_CLI === '1',
    },
    // Giờ gửi tự động (giờ Việt Nam)
    dailyHour: Number(process.env.DAILY_BRIEF_HOUR || 7),
    weeklyHour: Number(process.env.WEEKLY_REPORT_HOUR || 8),
    monthlyHour: Number(process.env.MONTHLY_REPORT_HOUR || 8),
  },
};
