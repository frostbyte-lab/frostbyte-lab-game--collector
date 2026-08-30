/**
 * Local, synthetic domain dataset for A Core Raa.
 * This is knowledge for deterministic matching, not an external AI or API.
 */
export const ARAA_DATASET_VERSION = "2026.08.30";
export const ARAA_CASE_DATASET = Object.freeze([
  { id: "URL-G1006", category: "network", signal: "G1006", title: "Origin unavailable or blocked", indicators: ["G1006", "ERR_NAME_NOT_RESOLVED", "DNS", "blocked"], confidence: 0.98, action: "Periksa DNS, TLS, redirect, dan status origin; jangan mem-bypass kontrol akses." },
  { id: "URL-REDIRECT-LOOP", category: "network", signal: "redirect-loop", title: "Redirect loop", indicators: ["too many redirects", "redirect loop", "ERR_TOO_MANY_REDIRECTS"], confidence: 0.96, action: "Catat rantai redirect dan gunakan URL resmi yang berhenti pada status 2xx." },
  { id: "URL-CORS", category: "network", signal: "cors", title: "Cross-origin policy mismatch", indicators: ["cors", "access-control-allow-origin", "blocked by CORS"], confidence: 0.95, action: "Gunakan origin yang diizinkan atau backend proxy yang memiliki allowlist." },
  { id: "ASSET-404", category: "asset", signal: "missing-asset", title: "Asset path unavailable", indicators: ["404", "missing", "not found", "failed to load resource"], confidence: 0.94, action: "Normalisasi base URL, cek case-sensitive path, dan pastikan asset tersedia." },
  { id: "ASSET-MIME", category: "asset", signal: "mime-mismatch", title: "MIME type mismatch", indicators: ["mime", "nosniff", "javascript mime", "text/html"], confidence: 0.93, action: "Validasi Content-Type dan X-Content-Type-Options sebelum rewrite offline." },
  { id: "ASSET-HASH", category: "integrity", signal: "integrity-mismatch", title: "Subresource integrity mismatch", indicators: ["integrity", "hash mismatch", "sha256", "sha384"], confidence: 0.97, action: "Hitung ulang hash dari resource resmi; jangan menghapus integrity tanpa otorisasi." },
  { id: "RUNTIME-SPA", category: "runtime", signal: "spa-fallback", title: "SPA route fallback missing", indicators: ["history api", "pushstate", "route", "index.html"], confidence: 0.89, action: "Tambahkan fallback route lokal dan uji refresh pada setiap route aplikasi." },
  { id: "RUNTIME-CANVAS", category: "runtime", signal: "canvas-runtime", title: "Canvas/WebGL runtime dependency", indicators: ["canvas", "webgl", "requestanimationframe", "pixi", "three"], confidence: 0.91, action: "Pertahankan urutan script, font, texture, dan capability check browser." },
  { id: "RUNTIME-WORKER", category: "runtime", signal: "worker-dependency", title: "Web Worker dependency incomplete", indicators: ["worker", "sharedworker", "blob:", "importscripts"], confidence: 0.94, action: "Map worker script dan importScripts secara terpisah; uji worker setelah offline rewrite." },
  { id: "CACHE-SW", category: "offline", signal: "service-worker", title: "Service worker cache gap", indicators: ["service worker", "cache", "caches.open", "fetch event"], confidence: 0.92, action: "Audit cache names, precache list, scope, dan versi cache tanpa mengubah scope secara diam-diam." },
  { id: "CACHE-INDEXEDDB", category: "offline", signal: "indexeddb", title: "IndexedDB state dependency", indicators: ["indexeddb", "indexeddb", "objectstore", "transaction"], confidence: 0.88, action: "Dokumentasikan schema/version dan siapkan seed state sintetis untuk replay offline." },
  { id: "API-AUTH", category: "security", signal: "credential-bound-api", title: "Credential-bound API", indicators: ["authorization", "cookie", "bearer", "csrf", "session"], confidence: 0.99, action: "Redact credential dan hentikan koleksi resource yang memerlukan sesi tanpa izin eksplisit." },
  { id: "API-DRM", category: "security", signal: "protected-media", title: "Protected or DRM resource", indicators: ["drm", "eme", "widevine", "license", "encryptedmedia"], confidence: 0.99, action: "Tandai blocked dan gunakan hanya resource yang memang berlisensi untuk offline." },
  { id: "API-WEBSOCKET", category: "network", signal: "websocket", title: "Realtime WebSocket dependency", indicators: ["websocket", "ws:", "wss:", "onmessage"], confidence: 0.93, action: "Catat handshake dan schema sintetis; jangan menganggap realtime service tersedia offline." },
  { id: "BUNDLE-LARGE", category: "performance", signal: "large-bundle", title: "Large bundle or capture", indicators: ["large", "bundle", "megabytes", "56mb"], confidence: 0.9, action: "Pecah asset dan alihkan proses besar ke runner yang sesuai batas kapasitas." },
  { id: "SECURITY-XSS", category: "security", signal: "unsafe-inline", title: "Potential unsafe inline execution", indicators: ["unsafe-inline", "innerhtml", "eval", "new function"], confidence: 0.86, action: "Review sink/source, pertahankan CSP ketat, dan jangan mengeksekusi input URL sebagai code." },
  { id: "SECURITY-OPEN-REDIRECT", category: "security", signal: "open-redirect", title: "Unvalidated redirect target", indicators: ["redirect", "location=", "returnurl", "next="], confidence: 0.87, action: "Allowlist hostname dan normalisasi URL sebelum fetch atau navigasi." },
  { id: "CAPTURE-INTERACTION", category: "capture", signal: "interaction-gated", title: "Content appears after interaction", indicators: ["click", "pointerdown", "visibilitychange", "lazy"], confidence: 0.84, action: "Catat langkah interaksi yang diizinkan dan gunakan replay deterministik." },
  { id: "CAPTURE-BOT-GATE", category: "capture", signal: "captcha-or-bot-gate", title: "Bot or CAPTCHA gate", indicators: ["captcha", "challenge", "verify you are human", "cloudflare"], confidence: 0.99, action: "Hentikan otomatisasi dan minta verifikasi manual; jangan mencoba melewati challenge." },
  { id: "FORMAT-ARCHIVE", category: "packaging", signal: "archive-invalid", title: "Archive or file format invalid", indicators: ["zip", "archive", "unexpected end", "invalid header"], confidence: 0.95, action: "Validasi magic bytes, checksum, dan ukuran sebelum unpack/repack." }
]);

export function matchAraaDataset(values = []) {
  const haystack = values.map((value) => String(value ?? "").toLowerCase()).join(" ");
  return ARAA_CASE_DATASET.filter((entry) => entry.indicators.some((indicator) => haystack.includes(indicator.toLowerCase())))
    .map((entry) => ({ id: entry.id, category: entry.category, signal: entry.signal, title: entry.title, confidence: entry.confidence, action: entry.action }));
}
