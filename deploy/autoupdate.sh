#!/usr/bin/env bash
# Tự cập nhật bot từ GitHub (nhánh main). Chạy bởi zb-autoupdate.timer mỗi 2 phút.
# - Không có bản mới: thôi.
# - Bot đang bận (Claude đang làm việc, trợ lí đang trả lời): đợi lần sau, tối đa 3 giờ rồi vẫn cập nhật.
# - Có bản mới: kéo về, cài thư viện, chạy kiểm thử; kiểm thử hỏng thì quay lại bản cũ, không khởi động lại.
set -uo pipefail
APP=${APP:-/opt/zalo-bot}
STATE=${STATE:-/var/lib/zalo-bot-autoupdate}
mkdir -p "$STATE"
as() { if [ -n "${NO_SUDO:-}" ]; then "$@"; else sudo -u zalobot -H "$@"; fi; }
cd "$APP" || exit 1

as git fetch -q origin main || { echo "Không lấy được từ GitHub"; exit 0; }
OLD=$(as git rev-parse HEAD)
NEW=$(as git rev-parse origin/main)
[ "$OLD" = "$NEW" ] && exit 0
[ "$(cat "$STATE/bad" 2>/dev/null)" = "$NEW" ] && exit 0  # bản này đã kiểm thử hỏng, đợi bản sửa

PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2); PORT=${PORT:-8787}
if curl -fsS "http://127.0.0.1:$PORT/api/busy" 2>/dev/null | grep -q '"busy":true'; then
  FIRST=$(cat "$STATE/waiting-since" 2>/dev/null || date +%s)
  echo "$FIRST" > "$STATE/waiting-since"
  if [ $(( $(date +%s) - FIRST )) -lt 10800 ]; then echo "Có bản mới ${NEW:0:7} nhưng bot đang bận, đợi lần sau"; exit 0; fi
  echo "Bot bận quá 3 giờ, vẫn cập nhật"
fi
rm -f "$STATE/waiting-since"

echo "Cập nhật ${OLD:0:7} -> ${NEW:0:7}"
as git merge -q --ff-only origin/main || { echo "Không gộp được (có sửa tay trên VPS?), bỏ qua"; exit 1; }
if ! as npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || ! as env -u ZALO_BOT_TOKEN npm test >/tmp/zalo-bot-test.log 2>&1; then
  echo "Kiểm thử hỏng, quay lại bản ${OLD:0:7}. Xem /tmp/zalo-bot-test.log"
  as git reset -q --hard "$OLD"
  echo "$NEW" > "$STATE/bad"
  as npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1
  exit 1
fi
# Cập nhật file dịch vụ nếu bản mới có thay đổi
[ -z "${NO_SUDO:-}" ] && cp "$APP"/deploy/systemd/*.service "$APP"/deploy/systemd/*.timer /etc/systemd/system/ 2>/dev/null
${SYSTEMCTL:-systemctl} daemon-reload
${SYSTEMCTL:-systemctl} restart zalo-bot
echo "Đã cập nhật lên ${NEW:0:7}: $(as git log -1 --format=%s)"
