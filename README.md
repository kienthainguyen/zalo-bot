# Bot Zalo "Bot Trợ lí ra lệnh"

Anh nhắn lệnh trên Zalo, VPS tự làm luồng tương ứng rồi nhắn lại kết quả. **Mọi thứ chạy trên VPS**, máy tính của anh không cần bật.

```
Zalo ──webhook──> VPS
                   ├─ Bot (Node.js): hiểu lệnh, xếp hàng việc, nhắn Zalo
                   ├─ Claude Code (đăng nhập tài khoản Claude của anh)
                   │     └─ điều khiển ──> Chrome trên VPS (màn hình ảo, đã đăng nhập sẵn
                   │                        Google Photos, video.kienthainguyen.com, sau này Facebook)
                   └─ noVNC: trang web có mật khẩu để anh xem / đăng nhập Chrome của VPS
```

## Lệnh hiện có
| Lệnh (có dấu hay không đều được) | Việc bot làm |
|---|---|
| `Edit cho a 10 video mới về trà` | Chọn 10 video trà mới trong Google Photos, đưa vào app dựng chuyên nghiệp |
| `Dựng cho a 3 video đồ họa giải thích về chủ đề "AI chốt sale tự động"` | Viết 3 kịch bản khác nhau theo chủ đề, dựng 3 video ở mục "Đồ họa giải thích" của app |
| `trạng thái` | Xem 5 việc gần đây |
| `hướng dẫn` | Danh sách lệnh |
| `id` | Xem Zalo id của mình |
| Tin nhắn bình thường bất kỳ | Trợ lí 3 AI trả lời, tự ghi việc và ghi nhớ (xem dưới) |
| `/viec` | Việc chưa xong |
| `/xong 12` | Đánh dấu việc #12 đã xong |
| `/baocao ngay` / `tuan` / `thang` | Báo cáo ngay |
| `/nho` | Những điều trợ lí đang ghi nhớ về anh |
| `/chedo tudong` / `luon` / `nhanh` | Lúc nào chạy đủ 3 AI |

- Chỉ Zalo id trong `ALLOWED_ZALO_IDS` ra lệnh được.
- Các việc chạy lần lượt vì dùng chung 1 Chrome. Đang có việc edit trà thì lệnh edit trà mới bị từ chối (tránh chọn trùng video); thêm chữ "vẫn chạy" để xếp hàng sau.
- Video đã dựng được lưu ở `data/processed.json` (nạp sẵn 8 video của 2 đợt trước), lần sau tự bỏ qua.

## Trợ lí 3 AI
Tin nhắn không phải lệnh video được giao cho trợ lí (`src/assistant/`):
- **Claude** (`claude-opus-5-5`, đổi bằng `CLAUDE_MODEL`) làm việc, có công cụ: tạo/cập nhật việc, xem việc, ghi nhớ/xoá ghi nhớ, tìm kiếm web.
- **Việc quan trọng** (có chữ phân tích, kế hoạch, đề xuất, chiến lược, tổng hợp, báo cáo, đánh giá, so sánh, tư vấn, giải pháp, lộ trình, rủi ro, có nên, "kỹ"; hoặc tin dài trên 300 ký tự): **GPT** phản biện → **Gemini** trọng tài quyết giữ nguyên hay bắt Claude sửa 1 lần. Cuối tin có 1 dòng ghi ai đã duyệt. GPT/Gemini lỗi thì vẫn gửi bản của Claude.
- **Bộ nhớ** ở `data/assistant.json`: việc (sắp làm / đang làm / đã xong / đã huỷ, ưu tiên, hạn), ghi nhớ lâu dài, lịch sử trò chuyện. Mỗi lần gọi Claude đưa vào: ngày giờ VN, ghi nhớ, việc chưa xong, việc xong 7 ngày qua, 16 tin gần nhất.
- **Tự gửi Zalo** (giờ VN): 7h hằng ngày nhắc việc; 8h thứ Hai báo cáo tuần; 8h ngày 1 báo cáo tháng trước. Báo cáo tuần/tháng cũng qua GPT + Gemini. Gửi tới người đầu tiên trong `ALLOWED_ZALO_IDS`.
- Câu có dấu hiệu trò chuyện (kế hoạch, báo cáo, xong, câu hỏi...) không chạy luồng video, kể cả khi có chữ "video trà".
- Khoá `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` để trong `/opt/zalo-bot/.env`. Claude Code chạy luồng video không thấy các khoá này (vẫn dùng gói Claude đã đăng nhập).

## Cần chuẩn bị
- VPS Ubuntu 22.04/24.04, tối thiểu **2 CPU, 4 GB RAM**, 30 GB ổ cứng.
- Một domain/subdomain trỏ (bản ghi A) về IP VPS, ví dụ `bot.kienthainguyen.com`. Mở cổng 80 và 443.
- Tài khoản Claude (gói Pro/Max) để đăng nhập Claude Code trên VPS.

## Cài đặt (làm 1 lần)
1. **Tạo bot Zalo:** vào https://bot.zaloplatforms.com, đăng nhập Zalo, tạo bot tên "Bot Trợ lí ra lệnh", copy token. Không gửi token qua chat.
2. **Copy mã nguồn lên VPS** (vd giải nén `zalo-bot.zip` vào `/root/zalo-bot`) rồi chạy:
   ```bash
   cd /root/zalo-bot && sudo bash deploy/install.sh bot.kienthainguyen.com
   ```
   Script cài Chrome, màn hình ảo, noVNC, Caddy (HTTPS tự động), Node 22, Claude Code và chạy tất cả dưới dạng dịch vụ tự khởi động. Cuối cùng nó in **mật khẩu trang noVNC**, anh ghi lại.
3. **Điền token:** `sudo nano /opt/zalo-bot/.env` → điền `ZALO_BOT_TOKEN` → `sudo systemctl restart zalo-bot`.
4. **Đăng nhập Claude Code:** `sudo -u zalobot -H claude` → gõ `/login`, làm theo hướng dẫn → `/exit`.
5. **Đăng nhập các trang trong Chrome của VPS:** mở link noVNC script in ra (dạng `https://bot.kienthainguyen.com/vnc/vnc.html?...`), đăng nhập user `admin` + mật khẩu ở bước 2. Trong Chrome hiện ra, đăng nhập:
   - Google (tài khoản có Google Photos chứa video trà). Google có thể hỏi xác minh trên điện thoại, anh bấm đồng ý.
   - https://video.kienthainguyen.com/ (và bấm kết nối Google Photos trong Cài đặt của app nếu app hỏi).
6. **Đăng ký webhook:** `cd /opt/zalo-bot && sudo -u zalobot npm run set-webhook`.
7. **Cấp quyền cho anh:** nhắn `id` cho bot trên Zalo → thêm id vào `ALLOWED_ZALO_IDS` trong `.env` → `sudo systemctl restart zalo-bot`.
8. Nhắn thử: `Edit cho a 2 video mới về trà`.

## Cập nhật bản mới
```bash
cd /opt/zalo-bot && sudo -u zalobot git pull && sudo -u zalobot npm install --omit=dev && systemctl restart zalo-bot
```

## Vận hành
- Log bot: `journalctl -u zalo-bot -f`. Log từng lần Claude chạy: `/opt/zalo-bot/data/logs/<mã việc>.log`.
- Xem Claude đang thao tác: mở trang noVNC.
- Bị đăng xuất (Google thỉnh thoảng bắt đăng nhập lại): bot nhắn link noVNC, anh vào đăng nhập lại rồi ra lệnh lại.
- Khởi động lại Chrome: `sudo systemctl restart zb-chrome`.
- Mỗi lần chạy dùng hạn mức gói Claude của anh.

## Thêm luồng mới
1. Tạo `src/workflows/<ten-luong>.js` theo mẫu `edit-tea.js`: `id`, `title`, `examples`, `match(text)` (trả tham số hoặc `null`), `validate?`, `start(job)`.
2. Viết prompt cho Claude ở `prompts/<ten-luong>.md` (quy trình thao tác, cách báo kết quả).
3. Thêm vào mảng trong `src/workflows/index.js`.
4. Nếu luồng cần trang mới (vd Facebook): đăng nhập trang đó trong Chrome của VPS qua noVNC.
5. Nếu app có API thì gọi thẳng trong `start(job)`, không cần Claude/Chrome.

## Kiểm thử
`npm test`: giả lập Zalo, Claude Code và 3 AI, không gọi mạng thật.
