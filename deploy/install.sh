#!/usr/bin/env bash
# Cài "Bot Trợ lí ra lệnh" lên VPS Ubuntu 22.04/24.04. Chạy bằng root từ thư mục mã nguồn:
#   sudo bash deploy/install.sh bot.kienthainguyen.com
set -euo pipefail
DOMAIN="${1:?Cách dùng: sudo bash deploy/install.sh <domain>}"
APP=/opt/zalo-bot
SRC="$(cd "$(dirname "$0")/.." && pwd)"

echo "== Cài gói hệ thống"
apt-get update
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https openssl
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
fi
apt-get install -y xvfb x11vnc novnc websockify fluxbox fonts-noto fonts-noto-color-emoji caddy
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v google-chrome >/dev/null; then
  curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y /tmp/chrome.deb
fi
npm install -g @anthropic-ai/claude-code @openai/codex

echo "== Người dùng và thư mục"
id zalobot >/dev/null 2>&1 || useradd -m -s /bin/bash zalobot
mkdir -p "$APP"
if [ "$SRC" != "$APP" ]; then cp -r "$SRC"/. "$APP"/; fi
mkdir -p "$APP/data" "$APP/chrome-profile"
if [ ! -f "$APP/.env" ]; then
  cp "$APP/.env.example" "$APP/.env"
  sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$DOMAIN#" "$APP/.env"
  sed -i "s#^ZALO_WEBHOOK_SECRET=.*#ZALO_WEBHOOK_SECRET=$(openssl rand -hex 24)#" "$APP/.env"
  sed -i "s#^NOTIFY_SECRET=.*#NOTIFY_SECRET=$(openssl rand -hex 32)#" "$APP/.env"
  sed -i "s#^VNC_URL=.*#VNC_URL=https://$DOMAIN/vnc/vnc.html?path=vnc/websockify\&autoconnect=1\&resize=remote#" "$APP/.env"
fi
chown -R zalobot:zalobot "$APP" && chmod 600 "$APP/.env"
(cd "$APP" && sudo -u zalobot npm install --omit=dev)

echo "== Dịch vụ"
cp "$APP"/deploy/systemd/*.service "$APP"/deploy/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now zb-xvfb zb-desktop zb-chrome zb-vnc zb-novnc zalo-bot zb-autoupdate.timer

echo "== HTTPS + mật khẩu trang noVNC"
VNC_PASS="$(openssl rand -base64 12)"
VNC_HASH="$(caddy hash-password --plaintext "$VNC_PASS")"
sed -e "s#__DOMAIN__#$DOMAIN#g" -e "s#__VNC_HASH__#$VNC_HASH#g" "$APP/deploy/Caddyfile.template" > /etc/caddy/Caddyfile
systemctl reload caddy

cat <<MSG

Xong phần cài. Còn lại:
 1. Điền ZALO_BOT_TOKEN và ALLOWED_ZALO_IDS trong $APP/.env rồi: systemctl restart zalo-bot
 2. Đăng nhập Claude:   sudo -u zalobot -H claude    (gõ /login, làm theo hướng dẫn, rồi /exit)
 3. Đăng nhập các trang trong Chrome của VPS: mở
      https://$DOMAIN/vnc/vnc.html?path=vnc/websockify&autoconnect=1&resize=remote
    Tài khoản: admin   Mật khẩu: $VNC_PASS   (ghi lại, chỉ hiện 1 lần)
 4. Đăng ký webhook:    cd $APP && sudo -u zalobot npm run set-webhook
 5. Trợ lí AI dùng gói ChatGPT Plus, đăng nhập 1 lần:
      sudo -u zalobot -H codex login --device-auth          (ChatGPT Plus)
MSG
