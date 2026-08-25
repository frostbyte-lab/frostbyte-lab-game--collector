# Game Collector Pro — Capacitor (Android APK)

Membungkus **URL live Worker** sebagai app Android (WebView).  
Update UI = deploy Worker; tidak perlu rebuild APK tiap perubahan frontend.

## Prasyarat

- Node.js 20+
- JDK 17+
- Android Studio (SDK 34+)
- URL Worker yang sudah di-deploy

## Setup cepat

```bash
cd mobile-capacitor
npm install

# Ganti URL jika beda worker
# edit capacitor.config.json → server.url

npx cap add android
npx cap sync android
npx cap open android
```

Di Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

APK debug biasanya di:

`android/app/build/outputs/apk/debug/app-debug.apk`

## Release (sideload)

1. Buat keystore (sekali):

```bash
keytool -genkey -v -keystore gc-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias gc
```

2. Konfigurasi signing di `android/app` (Android Studio: Generate Signed Bundle/APK).

3. Install di HP: izinkan *Install unknown apps*.

## Mode

| Mode | Cara | Kapan |
|------|------|--------|
| **Remote URL** (default) | `server.url` = Worker | Produksi / update cepat |
| **Bundle lokal** | Build `www/` statis + hapus `server.url` | Demo offline UI saja (API tetap butuh net) |

Default config memuat:

`https://game-resource-collector.technologiesfrostbyte.workers.dev`

## Catatan

- Collect / AI / proxy tetap di cloud (butuh internet).
- Bukan pengganti `android-app/` (Expo ZipScope) — itu pembaca ZIP native terpisah.
- Play Store: butuh privacy policy + review (scraping game pihak ketiga berisiko).
- Ikon: ganti `assets/icon.png` lalu `npx cap sync`.

## Troubleshooting

| Masalah | Coba |
|---------|------|
| White screen | Cek URL Worker & HTTPS; clear app data |
| Cleartext error | Jangan pakai `http://` di `server.url` |
| Capacitor not found | `npm install` di folder ini |
| Gradle gagal | Buka Android Studio → sync SDK |

## Alternatif lebih ringan

Tanpa Capacitor: [PWABuilder](https://www.pwabuilder.com) → package Android (TWA) dari URL Worker yang sama.
