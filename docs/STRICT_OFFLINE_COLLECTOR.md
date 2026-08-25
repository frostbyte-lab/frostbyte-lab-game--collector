# Strict Offline Collector

Implementasi spesifikasi **COLLECTOR OFFLINE GAME** (Strict Asset Collection, Rewrite & Validation).

## Modul baru

| Path | Fungsi |
|------|--------|
| `src/offline/strict-collector.js` | Core engine: classifyUrl, normalizeUrl, detectSignature, verifyDownload, findLocalAsset, sha256, computeOfflineScore, formatFinalReport, buildStrictPlan |
| `src/classify/resource.js` | Ditambah `STRICT_STATUS` + status field di setiap klasifikasi |
| `src/collect/fill-missing.js` | Verifikasi strict (HTTP + content-type + magic bytes + hash) sebelum simpan asset |
| `public/offline-analyze.js` | Score ketat + `reportText` format §57 + `formatStrictReport()` |

## Pipeline yang diikuti

```
LOAD ZIP → INDEX → SCAN → EXTRACT REFS → CLASSIFY
  → CHECK LOCAL → DOWNLOAD (verify) → SAVE → MANIFEST
  → REWRITE → RESCAN → VALIDATE → OFFLINE SCORE → FINAL REPORT
```

## Status asset (wajib jelas)

`LOCAL` | `DOWNLOADED` | `MISSING` | `FAILED` | `BACKEND` | `TRACKING` | `SVG_NAMESPACE` | `UNKNOWN`

## Offline Score

- Entry file hilang → −30
- Missing asset → −12 tiap
- Failed download → −10
- Broken reference → −8
- External tersisa → −6
- Tracking / API → warning (kurangi skor terbatas)

Status akhir:

- **OFFLINE READY** — missing=0, broken=0, external=0, entry OK
- **OFFLINE PARTIAL** — frontend bisa, masih ada API/backend dependency
- **OFFLINE FAILED** — asset penting hilang

## Cara pakai (Worker)

```js
import {
  classifyUrl, verifyDownload, buildStrictPlan,
  computeOfflineScore, formatFinalReport
} from "./offline/strict-collector.js";

const plan = buildStrictPlan({ urls: candidateUrls, zipIndex, strictMode: true });
// plan.assets / .tracking / .backend / .needDownload
```

## Cara pakai (browser)

```js
const check = await GCOfflineAnalyze.quickOfflineCheck(zip);
console.log(check.reportText);   // format §57
console.log(check.offlineScore, check.status);

const text = GCOfflineAnalyze.formatStrictReport({
  totalFiles: 241, downloaded: 6, missing: 0, offlineScore: 100, status: "OFFLINE READY"
});
```

## Yang sudah ketat vs spek

| Rule | Status |
|------|--------|
| Classify sebelum collect | ✅ |
| Tracking / SVG ignore | ✅ |
| Check local sebelum download | ✅ (findLocalAsset) |
| Verify HTTP + content + size + signature | ✅ |
| Hash (sha256) | ✅ |
| Strip query dari nama lokal | ✅ |
| Offline Score + READY/PARTIAL/FAILED | ✅ |
| Final report format §57 | ✅ |
| Mandatory full RESCAN loop di Worker | ⚠️ Pipeline Offline client-side sudah ada; Worker multi-pass fill tetap 2 pass |

Update 2026-08-26.
