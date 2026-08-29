# Game Provider Test Lab — Blueprint

## Tujuan

Game Collector Pro dikembangkan menjadi **Game Provider Test Lab** untuk menguji game web, provider API, dan operator backend secara berizin. Collector, Workspace, Sandbox, AI assistant, Hybrid Preview, realtime adapter, dan halaman `FULL_OFFLINE_READY` tetap dipertahankan sebagai satu alur.

> Target teknis yang benar adalah **compatibility dan conformance per game/provider**, bukan klaim bahwa semua game dapat dijalankan offline secara universal.

## Mode Operasi

| Mode | Tujuan | Network | Output |
|---|---|---|---|
| Authorized Research | Capture game yang dimiliki atau diizinkan | Diizinkan sesuai target | ZIP, manifest, license reference, capture log |
| Hybrid Test | Menguji asset lokal dengan API provider | API eksternal diizinkan | Perbandingan local/remote dan error log |
| Contract Capture | Merekam request/response dan urutan state | Hanya target berizin | `api-map.json`, contract, replay sequence |
| Mock Offline | Menjalankan client dengan emulator lokal | Network diblokir | Mock API, state machine, realtime replay |
| Provider Conformance | Membandingkan perilaku provider dengan kontrak game | Sandbox/staging atau fixture | Pass/fail per endpoint dan state |
| Full Offline Proof | Membuktikan satu ZIP tanpa network | Network-off wajib | Readiness report per paket |

## Mesin Inti yang Harus Dibangun

### 1. Contract Capture Engine

Setiap exchange menyimpan method, path yang sudah direduksi, request schema, response schema, status code, content type, timing, correlation ID, urutan, dan redacted body. Secret, cookie, authorization, token, signature, dan API key tidak boleh masuk fixture.

### 2. Provider Adapter Registry

Provider-specific adapter mendefinisikan endpoint session/init/balance/spin/result, normalisasi saldo dan round, error mapping, idempotency behavior, serta realtime transport. Game tanpa adapter tetap dapat diuji pada level shell/hybrid, tetapi tidak boleh diberi label full offline.

### 3. Stateful State Machine

State machine per game menggunakan state `NEW → SESSION → INITIALIZED → BALANCED → SPINNING → RESULT → SETTLED`, dengan cabang bonus, free spin, reconnect, timeout, dan error. Transition harus divalidasi terhadap captured contract, bukan asumsi generic.

### 4. Replay and Differential Runner

Satu fixture dapat dijalankan terhadap mock lokal dan provider sandbox/staging. Runner membandingkan schema, status, field penting, urutan event, latency budget, saldo sebelum/sesudah, round, payout, dan error path. Nilai sensitif dan RNG dinormalisasi tanpa mengubah fakta kontrak.

### 5. Realtime Lab

WebSocket, SSE, polling, reconnect, heartbeat, out-of-order event, duplicate event, dan disconnect diuji dengan record/replay adapter. Replay event harus memiliki sequence, timestamp relatif, channel, payload redacted, dan expected transition.

### 6. Offline Compatibility Proof

Proof menggabungkan static package audit, runtime network interception, API mock coverage, realtime coverage, dynamic import coverage, Service Worker cache, gameplay smoke test, dan network-off browser run. `FULL_OFFLINE_READY` hanya sah bila seluruh mandatory checks lulus untuk ZIP tersebut.

## Guardrail Otorisasi

Authorized Research Mode mewajibkan pengguna menyatakan target berizin dan mencatat URL/ID license. Challenge manual hanya mencatat bahwa pengguna menyelesaikan challenge; sistem tidak melakukan bypass CAPTCHA, anti-bot, DRM, auth pihak lain, atau rate limit. Uji beban dan pengujian negatif hanya boleh diarahkan ke sandbox/staging yang diberi izin dan memiliki batas request.

## Roadmap Implementasi

1. Normalisasi contract fixture dan redaction lintas Cloudflare/GitHub capture.
2. Registry adapter dan state machine per game/provider.
3. Replay runner plus differential report.
4. WebSocket/SSE/polling capture dan deterministic replay.
5. Dynamic dependency graph dan runtime URL/import coverage.
6. Conformance dashboard di Activity dengan evidence per test.
7. Offline proof runner per ZIP dan signed readiness report.
8. AI assistant untuk diagnosis dan repair plan; AI tidak mengubah hasil pass/fail tanpa evidence.

## Definisi Sukses

Platform dianggap kuat apabila dapat menjawab, untuk setiap paket: dependency apa yang tertangkap, endpoint apa yang dipakai, kontrak dan state apa yang terbukti, event realtime apa yang dibutuhkan, blocker apa yang tersisa, apakah mock kompatibel, apakah hybrid lulus, dan apakah gameplay benar-benar lulus ketika network diblokir.
