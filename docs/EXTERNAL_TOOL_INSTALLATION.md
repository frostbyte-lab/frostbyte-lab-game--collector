# External Tool Installation

Dokumen ini mencatat instalasi tool lab eksternal pada environment audit. Tool hanya digunakan untuk observabilitas, analisis artefak milik/berizin, dan validasi; tool tidak digunakan untuk membypass DRM, CAPTCHA, anti-bot, autentikasi, lisensi, signature, atau kontrol akses.

| Komponen | Status | Versi/lokasi terverifikasi |
|---|---|---|
| Chromium | Terpasang | `/usr/bin/chromium`, Chromium 151.0.7922.71 |
| Playwright | Terpasang di proyek | package `playwright` dari lockfile |
| CDP | Tersedia melalui Chromium + Playwright | Probe menggunakan Chromium/Playwright |
| WABT | Terpasang | `/usr/bin/wat2wasm`, WABT 1.0.34; `wasm-objdump` tersedia |
| mitmproxy | Terpasang | `/usr/bin/mitmproxy`, Ubuntu package 8.1.1 |
| Wireshark/tshark | Terpasang | `/usr/bin/wireshark`, `/usr/bin/tshark`, 4.2.2 |
| Ghidra | Terpasang | `/home/ubuntu/tools/ghidra/ghidra_12.1.3_PUBLIC`; `analyzeHeadless` tersedia |
| Java | Terpasang | OpenJDK 21.0.12, diperlukan Ghidra |

## Verifikasi

Jalankan dari root repository:

```bash
npm ci --ignore-scripts
npm run check:master-toolset
npm test
```

Probe bersifat pasif: probe hanya mencari executable/package dan tidak memulai proxy, packet capture, browser interception, atau analisis binary. Analisis traffic harus dilakukan hanya pada target yang memiliki izin.

Ghidra dipasang dari rilis resmi upstream `Ghidra_12.1.3_build` dan checksum arsip diverifikasi sebelum ekstraksi. Karena Ghidra dipasang di home directory, PATH pengguna harus memuat `$HOME/.local/bin`.
