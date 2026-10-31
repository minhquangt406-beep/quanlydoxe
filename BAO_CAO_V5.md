# SmartPark V5 – Kiểm thử và vá lỗi nghiệp vụ

Ngày: 27/10/2026

## Phạm vi
- Chạy lại bộ kiểm thử tự động trên SQLite tạm thời, không dùng PostgreSQL production.
- Phát hiện: nhân viên có thể gửi `payment_method: "Miễn phí"` để miễn toàn bộ phí cho xe không có vé tháng.
- Vá: chỉ quản lý (`manager`) được miễn phí thủ công; xe có vé tháng hợp lệ vẫn được miễn phí tự động.
- Bổ sung bài kiểm thử xác nhận nhân viên bị từ chối HTTP 403 khi miễn phí thủ công, lượt xe vẫn còn trong bãi và nhân viên có thể thanh toán bình thường.

## Kết quả thực chạy
`python -m pytest -q test_smoke_isolated.py test_workflow_isolated.py`

**8 passed in 1.00s**.

## Chưa kiểm thử
- PostgreSQL thực tế / bản sao PostgreSQL.
- Race condition khi nhiều xe check-in cùng lúc (đoạn kiểm tra slot rồi commit chưa có khóa hàng rõ ràng).
- Thanh toán cổng ngoài, chatbot API thực, trình duyệt iPhone, migration khi deploy.

## Trước khi triển khai
1. Sao lưu PostgreSQL bằng `pg_dump` tại môi trường an toàn; xác nhận file dump khôi phục được.
2. Kiểm thử trên bản sao PostgreSQL, không dùng database đang hoạt động.
3. Xác nhận quy tắc nghiệp vụ: quản lý có được miễn phí thủ công hay không.
4. Tạo branch/PR và chỉ merge sau khi xác nhận.

Không thay đổi GitHub, Render hoặc PostgreSQL production.
