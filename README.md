# Game Collector Pro

**Tools profesional untuk mengumpulkan, memperbaiki, dan menjalankan game web secara offline.**

Setelah di-collect, game bisa di-**preview & dimainkan offline** di browser:
- Tidak butuh server lokal
- Tidak memanggil API / server game asli
- Semua resource sudah ada di dalam ZIP

Mendukung dua jalur collect:
- **Cloudflare Worker** (cepat, ada limit free tier)
- **GitHub Actions** (gratis tanpa limit browser)

## Fitur

### Collect
- Capture resource client-side (HTML, JS, CSS, image, audio, font, XHR/fetch)
- Otomatis fallback info saat limit Cloudflare
- Output ZIP + manifest

### Workspace
- Load ZIP hasil collect
- **Preview Sandbox** — iframe terkontrol
- **Protected Mode** — netralisasi frame-buster + protector script
- **Isolated Window** — buka di window baru (bypass anti-iframe paling kuat)
- Terminal / log · Daftar file
- Auto Repair (frame-buster + path hint)
- Packaging ulang
- **AI Assistant** — analisis paket & saran perbaikan (Groq / OpenAI-compatible)

### Collect pintar (offline-ready)
- Struktur paket rapi: `assets/js`, `assets/css`, `assets/images`, `assets/audio`, …
- Smart path rewrite (absolute → local)
- Frame-buster neutralization saat collect
- Base tag + offline bootstrap (blokir fetch eksternal)
- ZIP langsung download dari browser (≤12 MB)
- Satu klik **Buka di Workspace** tanpa upload ulang

### Riwayat
- Disimpan di localStorage browser

## Cara Pakai

### Via Web (Cloudflare)
1. Deploy Worker (lihat `wrangler.jsonc`)
2. Buka frontend → tab **Collect** → masukkan URL → Capture
3. Jika limit → gunakan GitHub Actions

### Via GitHub Actions (tanpa limit)
1. Buka tab **Actions**
2. Pilih **Game Resource Collector**
3. **Run workflow** → isi URL
4. Download artifact **game-resources**

### Preview & mainkan offline (tanpa server)
1. Tab **Workspace**
2. Load file ZIP hasil collect
3. Pilih mode Preview:
   - **Sandbox** — default, aman
   - **Protected** — anti frame-buster
   - **Isolated Window** — paling kuat
4. Game jalan 100% di browser (blob URL). Tidak ada request ke server game asli.

> Tip: AI Assistant opsional (butuh API key). Preview & Auto Repair **tidak** butuh AI.

## Struktur

```
├── public/index.html          # Frontend Pro (Collect + Workspace + History)
├── src/index.js               # Cloudflare Worker (collect engine)
├── scripts/collect.js         # Playwright script untuk GitHub Actions
├── .github/workflows/collect.yml
└── wrangler.jsonc
```

## Prinsip

- User tidak perlu paham teknis backend
- Gagal pun memberi informasi berguna
- Setiap hasil collect bisa dilanjutkan ke Workspace
- Preview dirancang untuk konten yang mencoba mencegah iframe

## Catatan

- Hanya mengambil resource yang dikirim ke browser
- Tidak mengambil backend, database, atau proteksi DRM
- Gunakan hanya pada game yang kamu miliki atau punya izin
- Auto Repair tidak menjamin 100% semua game berjalan sempurna (logic server-side tetap sulit)

## AI Assistant

Di tab Workspace, isi API key (disarankan **Groq** gratis: https://console.groq.com).

- **Analisis Paket** — kesehatan file, path, potensi error
- **Saran Perbaikan** — rekomendasi konkret + contoh perubahan kode

Endpoint default sudah diisi untuk Groq. Bisa diganti OpenRouter / OpenAI / provider lain yang compatible.

## Roadmap

- [x] Collect + GitHub fallback
- [x] Workspace + Preview anti-iframe
- [x] Auto Repair + Packaging ulang
- [x] Smart path rewrite saat collect (v2 — relative, CSS url, protocol-relative)
- [x] AI Assistant (analisis + saran)
- [x] Estimasi waktu & progress real-time Collect
- [x] Notifikasi selesai (browser notification + suara)
- [x] Perbandingan sebelum/sesudah repair
- [x] Auto-click tombol Play / Start / Mulai
- [x] PWA / install sebagai app
- [ ] R2 otomatis untuk ZIP besar (butuh enable R2 di dashboard Cloudflare)
- [ ] History server-side (KV / Durable Object)
