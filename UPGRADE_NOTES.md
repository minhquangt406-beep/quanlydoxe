# Bản nâng cấp AI và ổn định hệ thống

- AI hỗ trợ: khi Node/xKiro lỗi, trả lời từ dữ liệu nội bộ thay vì HTTP 502; trả về `notice` để giao diện có thể thông báo.
- AI phân tích: giới hạn độ dài câu hỏi.
- Dự báo: không còn tự cộng 4–12% rồi gọi là dự báo; API đánh dấu `forecast_available=false` và nêu rõ chưa đủ dữ liệu.
- Node: kiểm tra vai trò, giới hạn kích thước ngữ cảnh, bỏ mốc năm cứng trong truy vấn.
- CORS: cấu hình `CORS_ORIGINS` theo danh sách origin phân cách dấu phẩy, mặc định không cấp quyền CORS cho nguồn ngoài.

## Cấu hình Render
Cần `DATABASE_URL` (PostgreSQL), `SECRET_KEY` đủ mạnh, `XKIRO_API_KEY` nếu dùng AI trực tuyến. `CORS_ORIGINS` chỉ cần khi frontend chạy khác origin. Không commit `.env`.

## Kiểm thử
`python -m compileall -q app` và `node --check node-chatbot/server.js`. Kiểm thử API thực tế cần cài requirements và cấu hình database.
