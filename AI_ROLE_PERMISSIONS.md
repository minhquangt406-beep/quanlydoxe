# SmartPark AI · Phân quyền câu hỏi theo vai trò

## Quản lý (`manager` / `admin`)
- Được hỏi dữ liệu quản trị: doanh thu, báo cáo, lịch sử doanh thu, nhật ký hoạt động, tài khoản, phân quyền, cài đặt.
- Được hỏi toàn bộ dữ liệu vận hành: chỗ trống, khu vực, xe đang gửi, biển số, vị trí và lịch sử gửi xe.

## Nhân viên (`staff`)
- Được hỏi dữ liệu vận hành phục vụ công việc: chỗ trống, khu vực, xe đang gửi, biển số, vị trí và lịch sử gửi xe.
- Không được hỏi dữ liệu quản trị: doanh thu, báo cáo quản trị, tài khoản, nhật ký hoạt động, phân quyền hoặc cài đặt doanh nghiệp.

## Khách (`guest`)
- Được hỏi thông tin công khai: chỗ trống, khu vực, mức phí, vé tháng, thông tin liên hệ và hướng dẫn chung.
- Không được xem biển số, danh sách xe, lịch sử vận hành, doanh thu hoặc dữ liệu quản trị.

## Bảo mật
Quyền được kiểm tra ở backend tại `/api/ai/support`, không chỉ bằng cách ẩn nút trên giao diện. Vì vậy việc gọi API trực tiếp cũng vẫn bị chặn nếu tài khoản không có quyền.
