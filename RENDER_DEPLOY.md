# Deploy quanlydoxe on Render

This project is a single Docker Web Service named `quanlydoxe`.

## Khởi động và triển khai

Docker cài gói chatbot trong image Node.js 22 chính thức rồi sao chép runtime
vào image Python. Không cần thêm kho apt hoặc khóa GPG của NodeSource.
`package-lock.json` và `npm ci` cố định phiên bản dependency.

- FastAPI lắng nghe `$PORT` (mặc định 8000).
- Chatbot dùng `NODE_INTERNAL_PORT` (mặc định 3100); FastAPI và kiểm tra sẵn sàng dùng cùng cổng.
- `start.sh` tự chuyển về thư mục dự án và dừng cả hai tiến trình khi nhận SIGTERM.
- Dùng Docker runtime cho service này; Python runtime đơn lẻ không cài chatbot.
- Giữ `DATABASE_URL` và `SECRET_KEY` hiện tại. Khi tạo cơ sở dữ liệu mới,
  đặt `BOOTSTRAP_ADMIN_PASSWORD` riêng ít nhất 12 ký tự để tạo tài khoản admin.

## Environment variables on the existing `quanlydoxe` service

Required for Google Gemini chatbot:

```text
GEMINI_API_KEY=your_key
GEMINI_MODEL=your_supported_model
WEB_SEARCH_ENABLED=true
WEB_SEARCH_CONTEXT_SIZE=medium
NODE_AI_SINGLE_SERVICE=true
NODE_AI_URL=http://127.0.0.1:3100
```

Optional OpenRouter fallback:

```text
OPENROUTER_API_KEY=your_key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

Do not create a separate `parking-ai-chat` Render service.

## Deploy

Push the contents of this project to the GitHub repository connected to `quanlydoxe`, then use Render's Manual Deploy / Deploy latest commit.

After deploy, check:

```text
https://quanlydoxe.cloud/api/health
```

Expected:

```json
{"status":"ok","service":"parking-ai-pro"}
```

The internal Node service is not exposed publicly; FastAPI calls it through `127.0.0.1:3100`.

## Kiểm tra bản sửa ngày 31/10/2026

8 kiểm thử API/nghiệp vụ đạt trên SQLite tạm: đăng nhập, phân quyền, xe vào/ra,
chặn gửi trùng, vé tháng và tính phí. Khởi động tích hợp với cổng tùy chỉnh
đã kiểm tra frontend, API, chatbot và dừng cả hai tiến trình bằng SIGTERM.
Image Docker cần được build trên Render; môi trường kiểm tra không có Docker.
