# Progress — Game Collector Pro

Update terakhir: 2026-08-15 (P2 Dependency Analyzer)

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
| A.4 | Engine-specific repair | ❌ | Deteksi engine ada; auto-repair khusus belum |
| A.5 | History server-side (KV) | ✅ | `GC_HISTORY` + `/api/history` + UI dual local/server |
| A.6 | Retry / Resume collect | ✅ | `/api/resume` + session KV + tombol Resume |
| A.7 | Custom domain | ⚠️ | Docs saja — pasang di CF Dashboard |

### Fondasi / infra
| ID | Item | Status | Catatan |
|----|------|--------|---------|
| P1 | Progress collect real (server poll) | ✅ | `/api/progress?id=` + KV `prog:{id}` + UI poll 800ms |
| P2 | Dependency Analyzer + Path Resolver | ✅ | `dependency.json` + skor dependencies + missing graph |
| KV | Namespace `gc-history` | ✅ | ID `3869a97c9eaf49129a666476fcb672e8` |
| Deploy | Worker live + binding | ✅ | MYBROWSER, GC_HISTORY, GITHUB_TOKEN |

---

## Belum (sisa)

### Tier 1
| # | Item | Status |
|---|------|--------|

### Tier 2 — Slot intelligence
| # | Item | Status |
|---|------|--------|
| 3 | Deteksi fitur game lebih dalam (FS, Bonus, Cascade, Wild, Scatter, Multiplier) | ⚠️ dasar ada |
| 4 | Deteksi & ekstraksi Paytable lebih akurat | ⚠️ hit ada |
| 5 | Mapping relasi asset (symbol ↔ animation ↔ audio) | ❌ |

### Tier 3 — Repair
| # | Item | Status |
|---|------|--------|
| 6 | Smart path rewrite lebih agresif | ⚠️ v2 ada |
| 7 | Engine-specific repair (Phaser / Pixi / Construct / Unity) | ❌ |
| 8 | Auto-repair lebih dalam (pakai Dependency Analyzer) | ❌ |

### Tier 4 — Infrastruktur & UX
| # | Item | Status |
|---|------|--------|
| 9 | R2 untuk ZIP besar (>~30MB) | ❌ |
| 10 | Live Viewer + Start/Stop Capture | ❌ |
| 11 | UI Split View + Workspace repair interaktif | ❌ |
| 12 | Proxy asset / SW cache asset di Preview | ⚠️ SW shell ada |
| 13 | Custom domain | ⚠️ manual Dashboard |

---

## Urutan lanjut disarankan

1. ~~Progress collect real~~ ✅
2. ~~Dependency Analyzer + Path Resolver~~ ✅
3. **Fitur game + Paytable lebih dalam** ← next
4. R2 ZIP besar
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

