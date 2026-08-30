# Provider Test Lab Blueprint

## Tujuan dan batas penggunaan

**Game Provider Test Lab** adalah fasilitas pengujian untuk game yang pengguna berwenang untuk audit. Sistem mengumpulkan artefak client, memetakan dependency, menangkap kontrak API, menyiapkan replay atau emulator lokal, lalu memvalidasi apakah ZIP tertentu benar-benar dapat dijalankan tanpa network. Sistem tidak ditujukan untuk membypass DRM, lisensi, anti-bot, autentikasi, signature, atau kontrol keamanan provider.

> `FULL_OFFLINE_READY` adalah hasil pengujian terhadap satu ZIP dan satu kontrak runtime tertentu; status tersebut bukan jaminan bahwa semua game provider dapat dibuat offline.

## Master Toolset 50 kemampuan

Registry `src/tools/master-toolset.js` memuat 50 kemampuan yang dikategorikan sebagai capture, analysis, runtime, offline, security, dan reporting. Dashboard pada Activity menampilkan status `active`, `partial`, atau `external`. Status external berarti alat tersebut memerlukan instalasi, otorisasi, dan proses terpisah; registry tidak memberikan kemampuan bypass.

Kemampuan utama meliputi Chromium/Playwright, CDP, mitmproxy, Wireshark, Ghidra, WABT, AST dan bundle analyzer, service worker dan web worker analyzer, URL/API detector, dependency graph, runtime discovery, URL-to-local mapping, API mock/hybrid backend, manifest/integrity engine, offline validator, DRM/license/anti-bot detector, request/response database, WebSocket analyzer, archive analyzer, sandbox offline, build/repack engine, regression tester, security auditor, audit log, dan final report generator.

## Pipeline pengujian yang wajib

| Tahap | Bukti minimum | Hasil jika gagal |
|---|---|---|
| Collect URL | HTML, JS, CSS, JSON, gambar, audio, font, worker, iframe, dan runtime request yang diizinkan | ZIP tidak lengkap |
| Asset validation | File dapat dibuka, MIME sesuai, hash dan ukuran tercatat | asset missing/corrupt |
| URL rewrite | Tidak ada asset signed CDN, iframe eksternal, worker eksternal, atau dynamic import wajib online | external dependency blocker |
| API capture | Session, init, balance, spin/play, result/settle, body, response, urutan, dan transport tercatat | API contract incomplete |
| Local replay/emulator | Kontrak replay atau stateful emulator sesuai schema game yang diuji | API contract mismatch |
| Security evidence | DRM, license server, anti-bot, signature, dan restriction signal tercatat | `AUTHORIZED_RESEARCH_REQUIRED` atau blocked |
| Browser network-off | load → session → init → balance → spin → result tanpa request keluar | `NOT_READY` |
| Report | manifest, evidence, log, findings, hash, dan keputusan quality gate tersimpan | final report incomplete |

## Aturan security evidence

Detector `src/analyze/security-evidence.js` menandai sinyal DRM, license server, anti-bot/challenge, token signature, dan restriction. Jika sinyal ditemukan, mode Authorized Research harus memuat referensi lisensi/izin resmi dan konfirmasi challenge manual. Sistem hanya mencatat bukti dan mengarahkan pengujian ke jalur yang sah; sistem tidak menghapus atau mengakali kontrol tersebut.

Header credential dan data sensitif harus disaring. Contract snapshot menyimpan method, URL/path, query keys, header yang telah direda​ksi, body terbatas, response status/content type, top-level keys, dan bentuk field. Nilai Authorization, Cookie, Set-Cookie, X-Api-Key, proxy-auth, token, dan secret tidak boleh dimasukkan ke ZIP, repository, laporan publik, atau localStorage.

## Quality gate offline

Validator menetapkan `FULL_OFFLINE_READY` hanya bila seluruh bukti tersedia: ZIP valid, manifest lengkap, analisis offline tersimpan, dependency blocker terselesaikan, API replay/emulator tersedia, runtime interceptor aktif, dan browser test network-off berhasil. Satu request jaringan yang lolos, satu asset wajib yang hilang, kontrak API yang tidak cocok, atau bukti keamanan yang belum diotorisasi harus menurunkan status menjadi `NOT_READY` atau `AUTHORIZED_RESEARCH_REQUIRED`.

AI Offline Readiness Assistant hanya membantu audit, diagnosis, dan prioritas perbaikan. AI tidak menentukan kelulusan sendiri, tidak mengubah payout/RNG/signature, dan tidak boleh menjadi dependency runtime game. Manus AI menggunakan secret server-side atau session key personal yang hanya hidup selama sesi; key tidak ditulis ke repository atau ZIP.

## Deployment dan verifikasi

Deployment Worker berjalan melalui `.github/workflows/deploy-worker.yml` pada push ke `main`. URL canonical production adalah [game-resource-collector.technologiesfrostbyte.workers.dev](https://game-resource-collector.technologiesfrostbyte.workers.dev). Endpoint health yang harus merespons sukses adalah `/api/health`, sedangkan registry dapat diverifikasi melalui `/api/tools/master` dan marker UI `MASTER TOOLSET` pada halaman utama.

Required checks untuk `main` adalah `Unit and inline-JS tests`, `Secret scan`, dan `CodeQL analysis`. Branch protection tetap ketat setelah proses merge: strict status checks aktif, satu approval diperlukan, code-owner review tetap diwajibkan, stale review didismiss, dan admin enforcement aktif.

## Checklist operasional

Sebelum menguji provider, pastikan URL dan game memang berizin, challenge manual diselesaikan melalui browser resmi, dan data credential tidak direkam. Setelah collect, periksa `manifest.json`, `api-map.json`, `research-metadata.json`, `security-evidence.json`, log network, dan report validator. Jalankan browser network-off pada setiap ZIP secara terpisah. Jangan menyatakan semua game offline hanya karena satu demo atau emulator generik berhasil.

## Referensi kode

| Komponen | Lokasi |
|---|---|
| Worker entry point dan endpoint registry/conformance | `src/index.js` |
| Registry 50 master tools | `src/tools/master-toolset.js` |
| Security evidence detector | `src/analyze/security-evidence.js` |
| Collector Playwright dan proactive asset capture | `scripts/collect.js` |
| Stateful API emulator | `src/offline/stateful-api-emulator.js` |
| Offline validation harness | `src/offline/offline-validation.js` |
| Required CI checks | `.github/workflows/quality-gates.yml` |
| Deployment workflow | `.github/workflows/deploy-worker.yml` |
