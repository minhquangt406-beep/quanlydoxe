# SmartPark — kiểm thử nghiệp vụ cách ly (27/10/2026)

- Môi trường: FastAPI TestClient, SQLite tạm thời, không sử dụng DATABASE_URL của Render.
- Chạy: `python -m pytest -q test_smoke_isolated.py test_workflow_isolated.py`
- Phạm vi: health, frontend, đăng nhập, API cần xác thực, tạo khu vực, cấu hình giá, xe vào, chặn xe vào trùng, xem trước thanh toán, xe ra, chặn xe ra lần hai, hóa đơn, đọc doanh thu, vé tháng miễn phí, hủy vé tháng, giới hạn quyền nhân viên.
- Ghi nhận: API tạo tài khoản chỉ cho phép role `manager` hoặc `staff` (không cho tạo `guest`); nhân viên được đọc doanh thu nhưng không được tạo khu vực. Đây là hành vi hiện tại, cần đối chiếu yêu cầu nghiệp vụ trước khi thay đổi.
- Chưa kiểm thử: PostgreSQL thực tế, cạnh tranh đồng thời nhiều lượt check-in, thanh toán qua ngân hàng thực, Node AI với nhà cung cấp thật, trình duyệt iPhone, dữ liệu sản xuất.
- Chưa chỉnh sửa logic backend hay database production. Không triển khai nhánh chính trước khi sao lưu PostgreSQL và thử staging.
