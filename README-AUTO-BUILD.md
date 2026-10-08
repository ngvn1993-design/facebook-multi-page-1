# Facebook Multi-Page — bản build tự động Windows

Mục tiêu: tạo `Facebook-Multi-Page-Setup-1.0.0.exe` để người dùng Windows chỉ cần cài và sử dụng.

## Cách dễ nhất: GitHub Actions

1. Tạo một repository GitHub mới.
2. Upload toàn bộ thư mục này lên repository.
3. Vào **Actions** → workflow **Build Windows Installer** → **Run workflow**.
4. Chờ build hoàn tất.
5. Mở phần **Artifacts** của workflow và tải `Facebook-Multi-Page-Windows-Installer`.
6. Giải nén artifact và chạy `Facebook-Multi-Page-Setup-1.0.0.exe`.

Không cần cài Node.js trên máy người dùng cuối. GitHub Actions tự chạy trên Windows và đóng gói Chromium vào ứng dụng.

## Build trực tiếp trên Windows

Mở PowerShell trong thư mục dự án và chạy:

```powershell
.\build-windows.ps1
```

Installer nằm trong thư mục `dist`.

## Sau khi cài

- Mở **Facebook Multi-Page**.
- Bấm đăng nhập Facebook.
- Đăng nhập trong cửa sổ Facebook.
- Tải danh sách Page.
- Chọn một hoặc nhiều Page.
- Nhập nội dung, chọn ảnh/video và đăng ngay hoặc hẹn giờ.

Dữ liệu phiên đăng nhập được lưu trong thư mục dữ liệu người dùng của Windows, không nằm trong `Program Files`.
