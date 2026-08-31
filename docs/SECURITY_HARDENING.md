# Security Hardening

## Scope

Game Collector hanya boleh digunakan untuk resource yang dimiliki atau telah diberi izin untuk diuji. Sistem **tidak** melewati DRM, anti-cheat, challenge, login, token, atau kontrol akses pihak lain.

## Asset proxy

`/api/asset-proxy` menerapkan validasi target HTTP(S), menolak credential URL dan alamat private/local (termasuk IPv4-mapped IPv6), mengikuti redirect secara manual maksimal tiga hop, memvalidasi ulang setiap target redirect, membatasi respons 12 MB, dan hanya meneruskan tipe `image/*`, `audio/*`, `video/*`, atau `font/*`. Jika deployment membutuhkan CDN lain, gunakan allowlist di depan endpoint ini; jangan menghapus validasi private-host dan redirect.

## Native API

Native API adalah **synthetic substitute untuk demo/lab**, bukan ledger produksi. Set `NATIVE_API_MODE=production` pada deployment yang belum memiliki database/ledger terotorisasi untuk membuat endpoint fail-closed dengan HTTP 503. Saat `NATIVE_API_KEY` dikonfigurasi, pembuatan sesi juga wajib mengirim header `X-Native-Api-Key`; simpan key sebagai Worker secret, bukan variable atau source code.

Sebelum produksi, ganti penyimpanan in-memory dengan database/ledger terotorisasi, autentikasi pemain yang sebenarnya, kontrol replay/idempotensi persisten, audit log append-only, dan rate limit berbasis Durable Object/KV atau layanan edge yang sesuai. Jangan menganggap session ID sebagai autentikasi pemain.

## Verification

Jalankan:

```bash
npm ci
npm test
npm run security:smoke
npm audit --omit=dev
```

Release harus dihentikan bila test, secret scan, dependency audit, atau protected-resource gate gagal. Temuan keamanan sebaiknya dilaporkan privately kepada pemilik repository tanpa credential atau data pribadi.
