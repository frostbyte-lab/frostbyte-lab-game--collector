# Game Collector Pro

**Tools profesional untuk mengumpulkan, memperbaiki, dan menjalankan game web secara offline.**

Mendukung dua jalur:
- **Cloudflare Worker** (cepat, ada limit free tier)
- **GitHub Actions** (gratis tanpa limit browser)

Dilengkapi **Workspace** dengan Preview Runtime level tinggi yang mampu menangani konten anti-iframe (frame-busting script + isolation).

## Fitur

### Collect
- Capture resource client-side (HTML, JS, CSS, image, audio, font, XHR/fetch)
- Otomatis fallback info saat limit Cloudflare
- Output ZIP + manifest

### Workspace (Baru)
- Load ZIP hasil collect
- **Preview Sandbox** — iframe terkontrol
- **Protected Mode** — netralisasi frame-buster + protector script
- **Isolated Window** — buka di window baru (bypass anti-iframe paling kuat)
- Terminal / log
- Daftar file
- Auto Repair (frame-buster + path hint)
- Packaging ulang

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

### Workspace
1. Tab **Workspace**
2. Load file ZIP
3. Pilih mode Preview:
   - Sandbox (default)
   - Protected (anti frame-buster)
   - Isolated Window (paling kuat)

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

## Roadmap

- [x] Collect + GitHub fallback
- [x] Workspace + Preview anti-iframe
- [x] Auto Repair dasar + Packaging ulang
- [ ] Path rewriting lebih cerdas saat collect
- [ ] Estimasi waktu & notifikasi
- [ ] Perbandingan sebelum/sesudah repair
