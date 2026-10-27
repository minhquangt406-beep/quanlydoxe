# SmartPark V3 — kiểm tra bảo mật trước triển khai

## Thay đổi đã thực hiện
- Xóa mật khẩu mặc định công khai trong logic tạo tài khoản ban đầu.
- Không sửa/xóa tài khoản hiện có trong cơ sở dữ liệu.
- So sánh mã băm mật khẩu theo thời gian hằng bằng `secrets.compare_digest`.

## Bắt buộc trước khi triển khai
1. Sao lưu PostgreSQL/SQLite trên Render. Không thay `DATABASE_URL` khi triển khai.
2. Đổi mật khẩu ngay cho tài khoản admin/staff/guest **nếu đã từng dùng mật khẩu mặc định**. Thay đổi mã nguồn không tự đổi mật khẩu đã lưu.
3. Đảm bảo `SECRET_KEY` trên Render là chuỗi bí mật mạnh, ổn định. Không thay tùy tiện vì sẽ làm mất hiệu lực phiên đăng nhập.
4. Với cơ sở dữ liệu mới, đặt `BOOTSTRAP_ADMIN_PASSWORD` (>=12 ký tự) để tạo admin ban đầu. Có thể đặt `BOOTSTRAP_STAFF_PASSWORD` và `BOOTSTRAP_GUEST_PASSWORD` nếu cần; bỏ các biến này sau khi tạo xong.
5. Kiểm thử đăng nhập, xe vào/ra, vé tháng, thanh toán, báo cáo và chatbot trên môi trường staging trước khi merge.
6. Không merge vào nhánh đang tự động deploy Render khi chưa xác nhận.

## Chưa xác nhận
Chưa chạy thử tích hợp với PostgreSQL/Render, chưa kiểm thử chức năng thực tế hoặc đánh giá bảo mật đầy đủ.
