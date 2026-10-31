# SmartPark v7 – AI + giao diện

- Sửa cấu trúc HTML: di chuyển style nằm trước DOCTYPE vào head.
- Bổ sung CSS responsive, trạng thái focus, tối ưu ô chat AI trên iPhone.
- Đổi nhãn AI từ “Online/LIVE” thành nhãn trung tính để tránh khẳng định dịch vụ luôn trực tuyến.
- Đổi câu hỏi gợi ý thời tiết thành tình hình bãi xe, phù hợp dữ liệu có sẵn.
- Lọc dữ liệu lịch sử chat đọc từ sessionStorage.
- Escape nội dung nhật ký hoạt động trước khi đưa vào HTML để giảm rủi ro XSS.
- Giữ nguyên PostgreSQL, API, Docker và cấu trúc Render.

## Chưa kiểm thử
- Chưa có PostgreSQL và API key trong môi trường kiểm thử nên chưa thể xác nhận end-to-end.
- Trợ lý AI nâng cao vẫn cần cấu hình dịch vụ Node.js và khóa API hợp lệ.
