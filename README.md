# Game Resource Collector (GitHub Actions)

**Gratis total · Tanpa limit harian Cloudflare**

Ambil resource game (HTML, JS, CSS, gambar, audio) lalu dapatkan file ZIP.

## Cara Pakai dari HP

1. Buka repository ini
2. Klik tab **Actions**
3. Di sebelah kiri pilih **Game Resource Collector**
4. Klik **Run workflow**
5. Isi **URL** game
6. Klik tombol hijau **Run workflow**
7. Tunggu 1–3 menit sampai selesai (tanda hijau)
8. Klik hasil run yang baru → bagian **Artifacts**
9. Download **game-resources**

## Catatan

- Hanya mengambil resource yang dikirim ke browser
- Tidak mengambil backend, database, atau proteksi DRM
- Gunakan hanya pada game yang kamu miliki atau punya izin

## Struktur

- `.github/workflows/collect.yml` → workflow GitHub Actions
- `scripts/collect.js` → script Playwright yang jalan di GitHub
