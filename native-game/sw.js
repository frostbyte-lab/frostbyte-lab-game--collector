const CACHE_NAME = "frostbyte-native-shell-v1.0.1";
const SHELL_ASSETS = ["./", "./index.html", "./manifest.json", "./shell/app.js", "./shell/bootstrap.js", "./shell/router.js", "./shell/state-store.js", "./shell/telemetry.js", "./shell/error-boundary.js", "./shell/accessibility.js", "./api/edu-network-adapter.js", "./config/native-game-config.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("frostbyte-native-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok && response.type === "basic") { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match("./index.html"))));
});
