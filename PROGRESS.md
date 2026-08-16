# Progress — Game Collector Pro

Update terakhir: 2026-08-16 (P0: quality gate kosong/403 + fix mapAssetRelations)

Repo: https://github.com/frostbyte-lab/frostbyte-lab-game--collector  
Live: https://game-resource-collector.technologiesfrostbyte.workers.dev

---

## Selesai

### A — Fitur gap awal
| ID | Item | Status | Catatan |
|----|------|--------|---------|
| A.1 | Laporan kelengkapan + skor kategori | ✅ | Symbols / Paytable / Audio / Atlas-Spine / Features / Engine + overall |
| A.2 | Mapping audio event | ✅ | BGM / Spin / ReelStop / Win / Bonus / UI / Other |
| A.3 | Deteksi atlas / Spine lebih dalam | ✅ | Region atlas, Spine JSON animations/skins/attachments |
| A.4 | Engine-specific repair | ✅ | Phaser/Pixi/Unity/Construct/Cocos patches di Auto Repair + collect |
| A.5 | History server-side (KV) | ✅ | `GC_HISTORY` + `/api/history` + UI dual local/server |
| A.6 | Retry / Resume collect | ✅ | `/api/resume` + session KV + tombol Resume |
| A.7 | Custom domain | ⚠️ | Docs saja — pasang di CF Dashboard |

### Fondasi / infra
| ID | Item | Status | Catatan |
|----|------|--------|---------|
| P1 | Progress collect real (server poll) | ✅ | `/api/progress?id=` + KV `prog:{id}` + UI poll 800ms |
| P2 | Dependency Analyzer + Path Resolver | ✅ | `dependency.json` + skor dependencies + missing graph |
| P3 | Deteksi fitur game lebih dalam | ✅ | FreeSpin, Bonus, Cascade, Wild, Scatter, Multiplier, Jackpot, Respin, Gamble, BuyFeature |
| P4 | Paytable lebih akurat | ✅ | structured map/array + symbol refs + skor kualitas |
| P9alt | ZIP besar tanpa R2 → GitHub | ✅ | Auto-failover TOO_LARGE / LIMIT_BROWSER → Actions artifact |
| P5 | Mapping relasi asset | ✅ | symbol ↔ image/atlas/spine ↔ audio + feature→audio |
| P7 | Engine-specific repair | ✅ | Phaser/Pixi/Unity/Construct/Cocos di Auto Repair Deep + packaging |
| P6 | Path rewrite agresif | ✅ | Multi-pass, srcset, escaped URLs, source map strip, tail-3 |
| P8 | Auto-repair dalam (Dependency) | ✅ | Pass-2 guided by dependency.json missingUnique |
| P12 | Proxy asset / SW cache | ✅ | SW v2 `/__gc__/` virtual ZIP + mode Preview SW Proxy |
| KV | Namespace `gc-history` | ✅ | ID `3869a97c9eaf49129a666476fcb672e8` |
| Deploy | Worker live + binding | ✅ | MYBROWSER, GC_HISTORY, GITHUB_TOKEN |
| P9alt | ZIP besar tanpa R2 → GitHub | ✅ | Auto-failover TOO_LARGE / LIMIT_BROWSER → Actions artifact |

---

## Belum (sisa)

### Tier 1
| # | Item | Status |
|---|------|--------|

### Tier 2 — Slot intelligence
| # | Item | Status |
|---|------|--------|

### Tier 3 — Repair
| # | Item | Status |
|---|------|--------|
| 6 | Smart path rewrite lebih agresif | ⚠️ v2 ada |

### Tier 4 — Infrastruktur & UX
| # | Item | Status |
|---|------|--------|
| 9 | R2 untuk ZIP besar (>~30MB) | ❌ skip (pakai GitHub Actions) |
| 10 | Live Viewer + Start/Stop Capture | ✅ |
| 11 | UI Split View + Workspace repair interaktif | ✅ |
| 13 | Custom domain | ⚠️ manual Dashboard |

---

## Urutan lanjut disarankan

1. ~~Progress collect real~~ ✅
2. ~~Dependency Analyzer + Path Resolver~~ ✅
3. ~~Fitur game + Paytable lebih dalam~~ ✅
4. ~~R2 ZIP besar~~ ✅
5. Engine-specific repair
6. Mapping relasi asset
7. Path rewrite + auto-repair dalam
8. Live Viewer / Split View / Proxy
9. Custom domain (Dashboard)

---

## Catatan teknis Progress real (P1)

- Client kirim `progressId` di body `POST /api/collect`
- Worker update fase ke KV: init → browser → page → loaded → interact → scroll → html → fill → rewrite → analyze → zip → done
- Client poll `GET /api/progress?id=...` tiap ~800ms
- Fallback estimasi lokal jika poll belum dapat data
- Butuh binding `GC_HISTORY` (sudah live)

---

*Update file ini setiap item selesai.*


## Catatan teknis Dependency Analyzer (P2)

- Modul: `src/analyze/dependency.js`
- Scan HTML/JS/CSS/JSON → extract refs (src/href, url(), import, string literal, json path)
- Resolve ke path lokal ZIP (exact, relative, bare, tail-2, URL pathname)
- Output: `dependency.json` + `analisis.dependencies` + skor di `kelengkapan.json`
- UI: bar "Dependencies resolved?" + daftar missing + top files



## Catatan teknis Fitur + Paytable (P3/P4)

- Feature types: FreeSpin, Bonus, Cascade, Wild, Scatter, Multiplier, Jackpot, Respin, Gamble, BuyFeature
- Scan JSON keys + JS text references
- Paytable: detect symbol→pays map, array of {symbol,pay}, structured score
- UI: tampil type counts + paytable key/kind/symbols



## Catatan teknis Auto-failover GitHub (tanpa R2)

- Capture Worker gagal `TOO_LARGE` (413) atau `LIMIT_BROWSER` (429) → UI auto panggil `runGitHubCollect({ auto: true })`
- Tidak perlu R2; artifact Actions jadi jalur paket besar
- User tetap bisa klik manual **Collect via GitHub**



## Catatan teknis Asset Relations (P5)

- Modul: `src/analyze/relations.js`
- Output: `relations.json`
- Match heuristik nama: symbol → images, atlas regions, spine anim/attach, audio
- Feature type → kategori audio (FreeSpin→Bonus/Win, Cascade→Spin/ReelStop, …)
- UI: skor "Asset relations linked?" + sample Relations: wild:img:atlas:sfx



## Catatan teknis Engine-specific repair (P7)

- Modul: `src/repair/engine-fix.js`
- UI Auto Repair Deep: deteksi engine dari analisis.json → patch setBaseURL/setPath (Phaser), PIXI basePath, Unity streaming/dataUrl, Construct data.json, Cocos server
- Collect packaging juga apply patch ringan
- Diff panel menampilkan engine + jumlah engine-fixes



## Catatan teknis Path rewrite + Auto-repair (P6/P8)

- `smart-rewrite.js`: 2-pass rewrite, CSS url, HTML attrs/srcset, escaped `https:\/\/`, strip sourceMappingURL
- Auto Repair Deep: resolveLocal + baseFile relative, tail-2/3
- Pass 2: baca `dependency.json` missingUnique → replace ref yang resolveable
- Engine patches (P7) tetap jalan di pass yang sama



## Catatan teknis SW Proxy (P12)

- `public/sw.js` v2: shell cache + ZIP cache `gc-pro-zip-v2`
- Message: `PUT_ZIP_ASSETS`, `CLEAR_ZIP`, `SKIP_WAITING`
- Route: `GET /__gc__/{path}` dari Cache
- UI: tombol **SW Proxy** → push ZIP ke SW → iframe src same-origin `/__gc__/index.html`
- Relative paths lebih stabil dibanding blob: origin


## Catatan teknis Split View + Interactive Repair (P11)

- Toggle **Split View** di Workspace → layout 3 kolom: File Tree | Code Editor | Preview
- Klik file text → buka di editor (html/js/css/json/…)
- **Save** (Ctrl/Cmd+S) menulis kembali ke `zipFS` + sync SW cache
- **Repair file**: path rewrite lokal hanya untuk file aktif (src/href/url/import/escaped URL)
- **Scan refs**: deteksi missing reference di file aktif (+ dependency.json)
- Filter path + shortcut Text / HTML / All
- Mode classic (sidebar) tetap ada saat Split View OFF
- Helper `esc()` + `log()` dilengkapi (sebelumnya dipakai tapi belum terdefinisi di bundle UI)

## Catatan teknis P0 — Quality gate + relations fix (2026-08-16)

- Import mapAssetRelations di src/index.js (sebelumnya ReferenceError)
- detectCollectFailure: 403/blocked/empty -> HTTP 422, X-GC-Ok: 0, history status blocked/empty
- UI: tampilkan COLLECT GAGAL, jangan tombol Preview seolah sukses
- loadZip: deteksi COLLECT_FAILED.json / index 403
- scripts/collect.js: exit 2 jika blocked atau 0 resource
- Bukan bypass WAF/403 situs pihak ketiga — hanya deteksi + gagal jujur

## Catatan teknis GitHub collect enhanced (2026-08-16)

- scripts/collect.js: auto-click Play (main+iframe), scroll, mainDocStatus, UA stabil, wait default 12s
- Quality gate tetap: exit 2 jika blocked/empty
- UI: wait_seconds 12, pesan gagal Actions lebih jelas
- Bukan bypass WAF; menyamakan kemampuan capture dengan Worker
