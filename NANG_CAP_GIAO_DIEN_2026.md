# SmartPark — Nâng cấp giao diện 27/10/2026

## Thay đổi thực tế
- Làm mới giao diện Dashboard, thẻ KPI, hành động nhanh, bảng biểu và trạng thái hover/focus.
- Bố cục responsive 2 cột cho KPI, 1 cột cho màn hình rất nhỏ, cải thiện chatbot trên iPhone và vùng safe-area.
- Sửa nhãn +12% so với hôm qua (số giả định không có nguồn dữ liệu).
- Thay nhãn 100% dữ liệu an toàn và trạng thái chatbot Online chưa được kiểm chứng.
- Escape nội dung lỗi từ API trước khi chèn vào HTML để hạn chế XSS.
- Gỡ đoạn JavaScript tùy biến theme trùng với trình xử lý theme gốc, tránh bật/tắt hai lần.
- Đổi phiên bản asset để trình duyệt nạp CSS/JS mới.

## Giới hạn
- Chưa thay đổi nghiệp vụ xe vào/ra, doanh thu, vé tháng, chatbot API hoặc cơ sở dữ liệu.
- Chưa kiểm thử tích hợp trên Render hay trình duyệt thật.
- Không đưa mã nguồn lên GitHub và không triển khai production.
- Trước khi deploy: sao lưu DB, xác minh SECRET_KEY, kiểm thử login/phân quyền/xe vào-ra/vé tháng/báo cáo/chatbot trên staging.
