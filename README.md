# Parking AI Pro Ultra Premium V5 – Business Edition

Bản quản lý bãi xe hướng kinh doanh, gồm Khu A/B, dashboard premium, DeepSeek AI, quản lý tài khoản/phân quyền, báo cáo doanh thu, biên lai in, thông tin doanh nghiệp và backup SQLite.

## Chạy
```bash
docker compose build --no-cache
docker compose up -d
```
Mở `http://localhost:8000`.

## DeepSeek
Điền `DEEPSEEK_API_KEY` trong `.env`. Không đưa API key vào frontend hoặc GitHub.

## Tài khoản mặc định
- Quản lý: `admin / admin123`
- Nhân viên: `staff / staff123`

## Tính năng Business
- Dashboard vận hành và sơ đồ Khu A/B
- Thêm/xóa khu (không cho xóa khu có xe/lịch sử)
- Quản lý tài khoản, vai trò
- Đổi mật khẩu
- Báo cáo doanh thu theo ngày/khu
- Biên lai sau khi checkout, có nút in
- Thông tin doanh nghiệp hiển thị trên biên lai
- Tải backup database SQLite
