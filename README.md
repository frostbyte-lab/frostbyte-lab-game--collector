# Game Collector Pro

Tools untuk **mengumpulkan, memisahkan, memperbaiki, dan menjalankan** resource game web (client-side) secara offline / hybrid.

**Live (canonical):** https://game-resource-collector.technologiesfrostbyte.workers.dev

**Repo:** https://github.com/frostbyte-lab/frostbyte-lab-game--collector

**Catatan URL:** Gunakan domain canonical di atas; domain lama `giesfrostbyte.workers.dev` tidak lagi menjadi alamat deployment aktif.

---

## Prioritas lanjut (1 / 2 / 3)

### Prioritas 1 — Fondasi produk (kerjakan dulu)
| No | Item | Status | Catatan untuk langkah berikutnya |
|----|------|--------|----------------------------------|
| 1.1 | **ZIP besar (>~25MB)** | ✅ via GitHub | Tanpa R2. Capture Worker → TOO_LARGE → auto-failover **Collect via GitHub Actions** (artifact). |
| 1.2 | **History server-side (KV)** | ✅ Aktif | KV `GC_HISTORY` dan progress store terdeteksi aktif pada health check live; API history tersedia untuk sesi capture. |
| 1.3 | **Progress collect real (polling)** | ✅ Aktif | Frontend memakai polling `/api/progress`; progress capture, file tertangkap, dan fase pipeline ditampilkan pada Preview. |

### Prioritas 2 — Offline & Preview lebih stabil
| No | Item | Status | Catatan untuk langkah berikutnya |
|----|------|--------|----------------------------------|
| 2.1 | **Service Worker asset di Preview** | ✅ Aktif | Service Worker mendukung cache asset ZIP dan kebijakan preview offline/hybrid. |
| 2.2 | **Proxy asset same-origin** | ✅ Aktif | Worker menyediakan endpoint `/api/asset-proxy`; health live mengonfirmasi asset proxy aktif. |
| 2.3 | **Auto-fill lebih dalam** | ⚠️ Max 40 file | Naikkan limit bertahap, multi-pass (scan lagi setelah fill), ikut URL dari source map / CSS nested. Kode: `fillMissingAssets()` di `src/index.js`. |
| 2.4 | **Engine-specific repair** | ⚠️ Deteksi engine ada; auto-repair khusus belum | Deteksi Phaser / Unity WebGL / Pixi / Construct → template path + loader fix khusus di Auto Repair Deep. |

### Prioritas 3 — Polish & skala
| No | Item | Status | Catatan untuk langkah berikutnya |
|----|------|--------|----------------------------------|
| 3.1 | Custom domain | ⚠️ Docs di wrangler + README | Workers Custom Domain / Routes di CF Dashboard. |
| 3.2 | Retry / resume collect | ⚠️ `/api/resume` + session KV | Simpan partial manifest + lanjut fetch missing. |
| 3.3 | Iframe “maksimal absolut” | ⚠️ Hard sudah ada | Isolated Window tetap cadangan; jangan janji 100% lawan anti-embed ekstrem. |

### Yang tidak perlu dikejar sebagai “100%”
- Offline penuh untuk game yang **logic-nya hanya di server**
- Bypass DRM / anti-cheat / login orang lain
- Multiplayer tanpa server resmi

---

## Yang sudah dikerjakan (catatan teknis)

### Collect
- [x] Cloudflare Browser Rendering (Playwright) + limit handling 429
- [x] GitHub Actions fallback (`scripts/collect.js` + workflow)
- [x] Auto-click Play/Start/Mulai (main frame + iframe)
- [x] Smart path rewrite v2 (absolute, protocol-relative, CSS `url()`, import)
- [x] Frame-buster neutralize saat package
- [x] **Klasifikasi otomatis** game vs API vs server → folder `assets/` vs `server/`
- [x] **KETERANGAN.md** + **keterangan.json** (host, endpoint, total per kategori)
- [x] **Auto-lengkapi** referensi yang belum terunduh (`fillMissingAssets`, max 40) + `kelengkapan.json`
- [x] Header meta: `X-GC-Game-Files`, `X-GC-Api-Files`, `X-GC-Fill-Ok`, dll.
- [x] ZIP binary langsung; package besar diarahkan ke GitHub Actions artifact

### Analisis slot (A.1–A.3)
- [x] **Skor kelengkapan per kategori** di `kelengkapan.json` + panel UI: Symbols, Paytable, Audio events, Atlas/Spine, Features, Engine (0–100 + overall)
- [x] **Mapping audio event** heuristik: BGM / Spin / ReelStop / Win / Bonus / UI / Other (dari nama file + path)
- [x] **Deteksi atlas/Spine lebih dalam**: parse region LibGDX atlas, Spine JSON (animations, skins, attachments, bones)
- [x] Output `analisis.json` + ringkasan di `kelengkapan.json` categories

### Workspace / Preview
- [x] Load ZIP (JSZip), file list, terminal log
- [x] Preview: Sandbox, Protected, **Online Hybrid**, Isolated Window
- [x] Hard iframe protection (lock top/parent/length, re-lock, nested iframe, open intercept)
- [x] Online Hybrid: asset lokal dulu, network server diizinkan; pakai snapshot original jika ada
- [x] Auto Repair **Deep**: path index, attr/srcset, import, JSON walk, missing report, offline bootstrap
- [x] Perbandingan sebelum/sesudah repair
- [x] **View kelengkapan** panel setelah load ZIP
- [x] Packaging ulang
- [x] AI Assistant (endpoint OpenAI-compatible / Groq)


### A.5–A.7 History KV · Resume · Custom domain
- [x] API `GET/POST/DELETE /api/history` (KV `GC_HISTORY`, fallback localStorage di UI)
- [x] API `POST /api/resume` — fetch `stillMissing` tanpa browser; session `sess:{id}` di KV (TTL 24 jam)
- [x] Collect menyimpan session jika masih ada missing + header `X-GC-Session-Id` / `X-GC-Still-Missing`
- [x] UI: tombol **Resume missing**, Resume dari riwayat, sumber history server/local
- [x] Custom domain: langkah di bawah (Dashboard CF, bukan kode)

#### Setup KV (wajib agar history server aktif)
1. Cloudflare Dashboard → **Workers & Pages** → **KV** → Create namespace `gc-history`
2. Copy **Namespace ID**
3. Uncomment di `wrangler.jsonc`:
   ```jsonc
   "kv_namespaces": [
     { "binding": "GC_HISTORY", "id": "NAMESPACE_ID_KAMU" }
   ]
   ```
4. `npx wrangler deploy`

#### Custom domain (A.7)
1. Dashboard CF → Workers → **game-resource-collector** → **Settings** → **Domains & Routes**
2. **Add Custom Domain** → isi mis. `collector.domain-kamu.com`
3. Ikuti instruksi DNS (CNAME / otomatis jika domain di CF)
4. Tidak perlu ubah kode repo

### UX
- [x] Progress bar + ETA (client-side estimate)
- [x] Notifikasi browser + suara selesai
- [x] PWA: `manifest.json` + `sw.js` (shell)
- [x] History **localStorage** saja

### Catatan batasan yang sudah disepakati di produk
- Hanya resource yang sempat dikirim ke browser saat collect
- API di `server/` = **snapshot**, bukan backend live
- Tanpa R2, ZIP besar (>~30MB) diproses melalui GitHub Actions artifact
- Logic hilang = game tidak bisa dimainkan
- Offline 100% hanya realistis untuk game client-side lengkap

---

## Struktur repo

```
├── public/
│   ├── index.html       # UI Collect + Workspace
│   ├── manifest.json    # PWA
│   └── sw.js            # Service worker (shell)
├── src/index.js         # Cloudflare Worker (collect + classify + fill + zip)
├── scripts/collect.js   # GitHub Actions collect
├── .github/workflows/collect.yml
├── wrangler.jsonc
└── README.md            # File ini
```

## Cara pakai singkat

1. **Collect** → URL game → Capture (atau GitHub Actions)
2. Baca status: game / API / auto-lengkapi
3. **Workspace** → Load ZIP → lihat panel kelengkapan
4. **Auto Repair (Deep)** jika perlu
5. Preview: Sandbox (offline) / Online Hybrid / Isolated Window

## Deploy

Checklist lengkap: **[docs/DEPLOY.md](docs/DEPLOY.md)**

```bash
npm install
npx wrangler secret put GITHUB_TOKEN   # opsional, untuk GitHub collect
npm run deploy
curl -s https://<worker>.workers.dev/api/health
```

Secret: `GITHUB_TOKEN`. Binding: Browser `MYBROWSER`, KV `GC_HISTORY`, AI (opsional). GitHub Actions menjadi jalur package besar.

---

## Android APK

| Path | Jenis |
|------|--------|
| **[mobile-capacitor/](mobile-capacitor/)** | Capacitor → WebView ke URL Worker (disarankan untuk app penuh) |
| [android-app/](android-app/) | Expo ZipScope (pembaca ZIP native, terpisah) |

```bash
cd mobile-capacitor && npm install && npx cap add android && npx cap sync && npx cap open android
```

---

## Lanjut kerja (opsional / sengaja ditunda)

1. Chunked GitHub artifact untuk ZIP sangat besar
2. Progress SSE penuh (sekarang poll)
3. Custom domain
4. Mock per-provider lebih dalam (snapshot collect tetap prioritas)

*Update catatan ini setiap selesai satu item prioritas.*
