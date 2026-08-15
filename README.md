# Game Collector Pro

Tools untuk **mengumpulkan, memisahkan, memperbaiki, dan menjalankan** resource game web (client-side) secara offline / hybrid.

**Live:** https://game-resource-collector.technologiesfrostbyte.workers.dev  
**Repo:** https://github.com/frostbyte-lab/frostbyte-lab-game--collector

---

## Prioritas lanjut (1 / 2 / 3)

### Prioritas 1 — Fondasi produk (kerjakan dulu)
| No | Item | Status | Catatan untuk langkah berikutnya |
|----|------|--------|----------------------------------|
| 1.1 | **R2 untuk ZIP besar** | ❌ Belum | Aktifkan R2 di Dashboard CF → buat bucket `game-collector-packages` → bind `COLLECTOR_BUCKET` di `wrangler.jsonc` → Worker sudah punya cabang `env.COLLECTOR_BUCKET.put`. Setelah enable, deploy ulang + uji ZIP >30MB. |
| 1.2 | **History server-side (KV)** | ❌ Belum | Tambah KV namespace `GC_HISTORY`, API `POST/GET /api/history`, ganti `localStorage` di frontend. Schema: `{ id, url, ts, status, files, zipSize, totals }`. |
| 1.3 | **Progress collect real (stream)** | ⚠️ Estimasi UI saja | Ganti long-request tunggal dengan SSE atau Durable Object status + poll. Frontend `startProgress()` sudah ada; tinggal sumber % dari server. |

### Prioritas 2 — Offline & Preview lebih stabil
| No | Item | Status | Catatan untuk langkah berikutnya |
|----|------|--------|----------------------------------|
| 2.1 | **Service Worker asset di Preview** | ⚠️ PWA SW dasar ada | Perluas `sw.js` untuk cache blob/asset map saat preview, bukan hanya shell app. |
| 2.2 | **Proxy asset same-origin** | ❌ Belum | Endpoint Worker `/api/asset-proxy` atau serve dari R2 agar path/cookie lebih stabil daripada murni `blob:`. |
| 2.3 | **Auto-fill lebih dalam** | ⚠️ Max 40 file | Naikkan limit bertahap, multi-pass (scan lagi setelah fill), ikut URL dari source map / CSS nested. Kode: `fillMissingAssets()` di `src/index.js`. |
| 2.4 | **Engine-specific repair** | ⚠️ Deteksi engine ada; auto-repair khusus belum | Deteksi Phaser / Unity WebGL / Pixi / Construct → template path + loader fix khusus di Auto Repair Deep. |

### Prioritas 3 — Polish & skala
| No | Item | Status | Catatan untuk langkah berikutnya |
|----|------|--------|----------------------------------|
| 3.1 | Custom domain | ❌ | Workers Custom Domain / Routes di CF Dashboard. |
| 3.2 | Retry / resume collect | ❌ | Simpan partial manifest + lanjut fetch missing. |
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
- [x] ZIP binary langsung (tanpa R2); R2 opsional jika bucket di-bind

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

### UX
- [x] Progress bar + ETA (client-side estimate)
- [x] Notifikasi browser + suara selesai
- [x] PWA: `manifest.json` + `sw.js` (shell)
- [x] History **localStorage** saja

### Catatan batasan yang sudah disepakati di produk
- Hanya resource yang sempat dikirim ke browser saat collect
- API di `server/` = **snapshot**, bukan backend live
- Tanpa R2, ZIP besar (>~30MB) rawan gagal
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

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
npx wrangler deploy
```

Secret yang dipakai: `GITHUB_TOKEN` (untuk trigger/status Actions).  
Binding opsional nanti: `COLLECTOR_BUCKET` (R2), `GC_HISTORY` (KV).

---

## Lanjut kerja disarankan

1. User enable **R2** di Dashboard → implement bind + download URL besar  
2. **KV history**  
3. **SSE/progress** collect  
4. Baru polish Preview (SW asset / proxy / engine pack)

*Update catatan ini setiap selesai satu item prioritas.*
