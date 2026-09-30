# Đăng nhập bằng Google

1. Vào Google Cloud Console → Google Auth Platform → Clients.
2. Tạo OAuth 2.0 Client ID với loại Web application.
3. Thêm Authorized JavaScript origin: `https://quanlydoxe.cloud`.
4. Lấy Client ID có dạng `...apps.googleusercontent.com`.
5. Trên Render, thêm biến môi trường `GOOGLE_CLIENT_ID` với giá trị Client ID đó.
6. Deploy lại service.

Tài khoản Google mới sẽ được tạo với quyền `guest`, chỉ xem tình trạng chỗ trống. Nếu email Google đã liên kết với tài khoản hiện có, hệ thống sẽ liên kết Google vào tài khoản đó.

Backend xác thực ID token bằng thư viện `google-auth` và kiểm tra audience theo Client ID đã cấu hình.
