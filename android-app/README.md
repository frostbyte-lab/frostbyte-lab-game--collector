# ZipScope Android APK

ZipScope adalah aplikasi Android native untuk membuka ZIP besar, membaca folder bersarang, dan mempreview file di dalamnya.

## Yang didukung

- ZIP besar dengan reader binary dan ekstraksi item secara lazy
- HTML/HTM dijalankan sebagai preview web
- JPG, JPEG, PNG, GIF, WebP, SVG
- MP3 dengan kontrol putar/jeda
- MP4 dengan kontrol video native
- CSS, JavaScript, TypeScript, Python, JSON, Markdown, TXT, XML, YAML
- Panel preview 70% dan log error 30%
- Mode preview web layar penuh

## Pengujian ZIP

Dari root repository jalankan:

pnpm --dir android-app test

Smoke test membuat arsip sementara 12 MB dan 40 MB, membaca HTML dan gambar di dalamnya, lalu memastikan ZIP rusak ditolak.

## Menjalankan aplikasi

cd android-app
pnpm install
pnpm exec expo start

## APK release lokal

pnpm exec expo prebuild --platform android --non-interactive --clean
cd android
./gradlew assembleRelease

APK berada di android/app/build/outputs/apk/release/app-release.apk.

## Catatan

ZIP terenkripsi memerlukan password dan saat ini ditolak dengan pesan error yang jelas; aplikasi tidak mencoba melewati enkripsi.