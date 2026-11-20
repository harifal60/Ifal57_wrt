# IFAL57_WRT

Katalog APK sederhana untuk HP Android dan Android TV/STB. Pengguna dapat melihat dan mengunduh APK; hanya admin yang dapat mengunggah atau menghapus aplikasi.

## Jalankan lokal
1. Install Node.js 20 atau lebih baru.
2. Jalankan `npm install`.
3. Jalankan `npm start`.
4. Buka `http://localhost:3000`.
5. Tekan ADMIN dan buat akun admin pertama.

## Deploy Railway
1. Upload project ini ke repository GitHub.
2. Buat project baru di Railway dari repository tersebut.
3. Tambahkan Volume dan mount ke `/app/data`.
4. Tambahkan variable `DATA_DIR=/app/data`.
5. Tambahkan variable `SESSION_SECRET` dengan nilai acak yang panjang.
6. Deploy, lalu buka domain publik dan buat akun admin pertama.

## Catatan penting
- File APK dan katalog disimpan di `DATA_DIR`; gunakan volume persisten agar tidak hilang saat redeploy.
- Batas upload saat ini 300 MB.
- Instal APK memerlukan persetujuan pengguna Android dan pengaktifan izin instalasi dari sumber yang digunakan.
- Unggah hanya APK yang Anda miliki atau berhak distribusikan. Periksa keamanan setiap APK sebelum membagikannya.
- Ini adalah versi awal: belum ada verifikasi tanda tangan APK, pemindaian malware, pemulihan password, atau pembatasan percobaan login. Gunakan password kuat dan jangan bagikan akses admin.


## Aturan akun dan lisensi perangkat
- Aplikasi boleh digunakan untuk beberapa akun pelanggan, tetapi satu perangkat hanya boleh terikat ke satu akun pada satu waktu.
- Untuk berpindah akun di perangkat yang sama: keluar dari akun lama, minta admin membuka panel pengguna dan menekan **Reset perangkat** pada akun lama, lalu login dengan akun berikutnya.
- Reset perangkat hanya melepas ikatan perangkat. Reset ini tidak menghapus akun, password, masa trial, status Premium, atau tanggal kedaluwarsa lisensi.
- Akun yang masih terikat pada perangkat lain tetap memerlukan reset perangkat oleh admin sebelum dipindahkan.
