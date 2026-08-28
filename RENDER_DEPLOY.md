# Parking AI Pro – Render deployment (PostgreSQL)

## 1. GitHub
Giải nén ZIP và upload **nội dung bên trong** vào ROOT repository. Không upload thư mục cha.

Repository root phải có:
- Dockerfile
- requirements.txt
- render.yaml
- app/
- .gitignore

**Không upload `.env` lên GitHub.**

## 2. Render
Nếu dùng Blueprint, Render sẽ đọc `render.yaml` để tạo Web Service và PostgreSQL.
- Runtime: Docker
- Dockerfile: `./Dockerfile`
- Health Check: `/api/health`
- `DATABASE_URL` được nối tự động với PostgreSQL.

Nếu bạn đã có PostgreSQL cũ, hãy giữ database đó và kiểm tra `DATABASE_URL` trỏ đúng database trước khi deploy.

## 3. Environment variables
Trên Render → Web Service → Environment:
- `DATABASE_URL`: Internal Database URL của PostgreSQL
- `SECRET_KEY`: chuỗi bí mật dài, hoặc để Render generate
- `DEEPSEEK_API_KEY`: tùy chọn
- `DEEPSEEK_MODEL`: `deepseek-chat`
- `DEEPSEEK_BASE_URL`: `https://api.deepseek.com`

## 4. Dữ liệu bền vững
Dữ liệu xe, lịch sử, tài khoản, khu vực, ô đỗ, bảng giá và nhật ký hoạt động được lưu trong PostgreSQL.
Không xóa PostgreSQL khi redeploy Web Service.

## 5. Kiểm tra
Sau khi Deploy thành công, mở `/api/health`. Kết quả phải có `status=ok` và `database=connected`.

## 6. Tính năng bản này
- Giờ xe vào/ra theo giờ Việt Nam (UTC+7).
- Giữ phiên đăng nhập khi rời trang dưới 30 phút.
- Tự nhận diện xe máy/ô tô theo cấu trúc biển số.
- Dashboard có lượt vào/ra và doanh thu hôm nay.
- Nhật ký hoạt động quản trị, xe vào/ra, thay đổi bảng giá/khu vực/tài khoản.
- Bảo vệ lịch sử: không cho xóa phương tiện đã phát sinh lịch sử.
- Giao diện mobile và bảng dữ liệu có thể vuốt ngang.
