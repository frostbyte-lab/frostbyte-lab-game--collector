/* Game Collector Pro — SW v2: shell cache + virtual ZIP assets under /__gc__/ */
const SHELL = "gc-pro-shell-v2";
const ZIP_CACHE = "gc-pro-zip-v2";
const ASSETS = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL && k !== ZIP_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function mimeOf(path) {
  const ext = (path.split(".").pop() || "").toLowerCase();
  const map = {
    html: "text/html",
    htm: "text/html",
    js: "application/javascript",
    mjs: "application/javascript",
    css: "text/css",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    mp4: "video/mp4",
    webm: "video/webm",
    wasm: "application/wasm",
    atlas: "text/plain",
    txt: "text/plain"
  };
  return map[ext] || "application/octet-stream";
}

self.addEventListener("message", (e) => {
  const data = e.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "CLEAR_ZIP") {
    e.waitUntil(
      caches.delete(ZIP_CACHE).then(() => {
        e.ports && e.ports[0] && e.ports[0].postMessage({ ok: true });
      })
    );
    return;
  }
  if (data.type === "PUT_ZIP_ASSETS" && Array.isArray(data.assets)) {
    e.waitUntil(
      (async () => {
        const cache = await caches.open(ZIP_CACHE);
        // optional clear first
        if (data.clear) {
          const keys = await cache.keys();
          await Promise.all(keys.map((k) => cache.delete(k)));
        }
        let n = 0;
        for (const item of data.assets) {
          if (!item || !item.path || !item.buffer) continue;
          const path = String(item.path).replace(/^\/+/, "");
          const url = new URL("/__gc__/" + path, self.location.origin).href;
          const headers = new Headers({
            "Content-Type": item.mime || mimeOf(path),
            "Cache-Control": "no-store",
            "X-GC-Asset": "1"
          });
          const res = new Response(item.buffer, { status: 200, headers });
          await cache.put(url, res);
          n++;
        }
        if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true, count: n });
      })().catch((err) => {
        if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: false, error: String(err) });
      })
    );
  }
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // API never cache
  if (url.pathname.startsWith("/api/")) return;

  // Virtual ZIP assets
  if (url.pathname.startsWith("/__gc__/")) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(ZIP_CACHE);
        // exact
        let hit = await cache.match(e.request);
        if (hit) return hit;
        // try decode
        const rel = decodeURIComponent(url.pathname.slice("/__gc__/".length));
        hit = await cache.match(new URL("/__gc__/" + rel, self.location.origin).href);
        if (hit) return hit;
        // bare filename fallback
        const bare = rel.split("/").pop();
        if (bare) {
          const keys = await cache.keys();
          for (const req of keys) {
            if (req.url.endsWith("/" + bare) || req.url.endsWith("/__gc__/" + bare)) {
              const r = await cache.match(req);
              if (r) return r;
            }
          }
        }
        return new Response("GC asset not in cache: " + rel, {
          status: 404,
          headers: { "Content-Type": "text/plain" }
        });
      })()
    );
    return;
  }

  // App shell: cache-first
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const net = fetch(e.request)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const clone = res.clone();
            caches.open(SHELL).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});
