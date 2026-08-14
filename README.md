# Game Resource Collector

Ambil resource game web (HTML, JS, CSS, gambar, audio) lalu bungkus jadi ZIP.

## Dua Cara Pakai

### 1. Cloudflare Worker (cepat, ada limit)
- Limit free: **10 menit browser per hari**
- Cocok untuk capture cepat dari HP

### 2. GitHub Actions (gratis total, tanpa limit harian)
1. Buka tab **Actions**
2. Pilih **Game Resource Collector**
3. Klik **Run workflow**
4. Masukkan URL game
5. Tunggu selesai → download ZIP di **Artifacts**

## Deploy ke Cloudflare
1. Ganti nama R2 bucket di `wrangler.jsonc`
2. `npm install`
3. `npx wrangler deploy`

Gunakan hanya pada game yang kamu miliki atau punya izin.
