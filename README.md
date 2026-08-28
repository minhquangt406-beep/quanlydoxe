# Parking AI Pro

Hệ thống quản lý bãi đỗ xe với FastAPI + PostgreSQL + giao diện responsive.

## Điểm chính
- Quản lý xe vào/ra, khu A/B và vị trí đỗ.
- Tính phí theo loại xe.
- Tự nhận diện loại xe từ cấu trúc biển số.
- Dashboard và báo cáo doanh thu.
- Phân quyền quản lý/nhân viên.
- Nhật ký hoạt động.
- PostgreSQL persistent trên Render.
- Mobile responsive.

## Chạy local
1. Sao chép `.env.example` thành `.env` và điền `DATABASE_URL`.
2. Cài requirements.
3. Chạy `uvicorn app.main:app --host 0.0.0.0 --port 8000`.

Không commit `.env` vào GitHub.
