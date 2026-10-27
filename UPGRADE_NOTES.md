# SmartPark – bản nâng cấp an toàn (27/10/2026)

## Đã thay đổi
- CORS: mặc định same-origin, chỉ bật cho danh sách `CORS_ORIGINS` phân tách dấu phẩy.
- Render: bắt buộc thiết lập `SECRET_KEY` bí mật, ổn định để ký JWT. **Kiểm tra biến này trước khi triển khai.**
- Tăng khả năng truy cập bàn phím, vùng chạm trên di động, chống iOS tự zoom input và tôn trọng reduced-motion.
- Loại dữ liệu `data/parking.db` và file cache khỏi bản ZIP để tránh chia sẻ dữ liệu cá nhân.

## Trước khi triển khai
1. Sao lưu cơ sở dữ liệu đang chạy trên Render.
2. Đảm bảo Render có `SECRET_KEY` đủ mạnh, giữ nguyên khóa cũ để tránh đăng xuất hàng loạt.
3. Nếu frontend/API ở các domain khác nhau, thiết lập `CORS_ORIGINS=https://ten-mien-cua-ban`.
4. Kiểm thử đăng nhập, phân quyền, xe vào/ra, doanh thu, vé tháng, chatbot trên staging.
5. Chỉ merge lên nhánh Render auto-deploy sau khi kiểm thử.

Chưa thực hiện kiểm thử end-to-end hay triển khai production.
