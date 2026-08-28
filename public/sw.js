/* Game Collector Pro — SW v6: shell + ZIP /__gc__/ + hybrid API policy */
const SHELL = "gc-pro-shell-v9";
const ZIP_CACHE = "gc-pro-zip-v5";
const VENDOR_CACHE = "gc-pro-vendor-v1";
const ASSETS = ["/", "/index.html", "/manifest.json", "/offline-analyze.js"];
const VENDOR_ASSETS = ["/vendor/"];

/** @type {{ mode: 'hybrid'|'offline', apiPatterns: string[], allowHosts: string[] }} */
let HYBRID_POLICY = {
  mode: "hybrid",
  apiPatterns: [
    "/api/",
    "/v1/",
    "/v2/",
    "/graphql",
    "/session",
    "/spin",
    "/bet",
    "/balance",
    "/wallet",
    "/auth",
    "/login",
    "/wss",
    "/ws"
  ],
  allowHosts: []
};

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(ASSETS))
      .then(() => caches.open(VENDOR_CACHE))
      .then((c) => c.addAll(VENDOR_ASSETS).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => ![SHELL, ZIP_CACHE, VENDOR_CACHE].includes(k)).map((k) => caches.delete(k))
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

function isApiRequest(url) {
  const path = (url.pathname || "").toLowerCase();
  const href = (url.href || "").toLowerCase();
  for (const p of HYBRID_POLICY.apiPatterns || []) {
    const pat = String(p).toLowerCase();
    if (!pat) continue;
    if (path.includes(pat) || href.includes(pat)) return true;
  }
  // websocket upgrade not handled here; path hints
  if (/\/(spin|bet|wager|balance|wallet|session|login|auth)\b/i.test(path)) return true;
  return false;
}

function isStaticAssetPath(pathname) {
  return /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|js|mjs|css|woff2?|ttf|otf|mp3|ogg|wav|m4a|mp4|webm|wasm|json|atlas|html?)$/i.test(
    pathname
  );
}

function offlineApiMock(url) {
  const body = JSON.stringify({
    ok: false,
    offline: true,
    hybrid: false,
    message: "Offline mode: request API diblokir di Service Worker. Gunakan Preview Hybrid untuk network server.",
    url: url.href,
    source: "gc-sw-v6"
  });
  return new Response(body, {
    status: 503,
    headers: {
      "Content-Type": "application/json",
      "X-GC-Offline": "1",
      "X-GC-Hybrid-Policy": HYBRID_POLICY.mode
    }
  });
}

self.addEventListener("message", (e) => {
  const data = e.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "SET_HYBRID_POLICY") {
    HYBRID_POLICY = {
      mode: data.mode === "offline" ? "offline" : "hybrid",
      apiPatterns: Array.isArray(data.apiPatterns) ? data.apiPatterns : HYBRID_POLICY.apiPatterns,
      allowHosts: Array.isArray(data.allowHosts) ? data.allowHosts : []
    };
    if (e.ports && e.ports[0]) {
      e.ports[0].postMessage({ ok: true, policy: HYBRID_POLICY });
    }
    return;
  }
  if (data.type === "GET_HYBRID_POLICY") {
    if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true, policy: HYBRID_POLICY });
    return;
  }
  if (data.type === "PUT_VENDOR_ASSETS" && Array.isArray(data.assets)) {
    e.waitUntil(
      (async () => {
        const cache = await caches.open(VENDOR_CACHE);
        if (data.clear) {
          await Promise.all((await cache.keys()).map((request) => cache.delete(request)));
        }
        let count = 0;
        for (const item of data.assets) {
          if (!item || !item.url || !item.body) continue;
          const request = new Request(String(item.url), { method: "GET" });
          const headers = new Headers(item.headers || {});
          if (!headers.has("Content-Type")) headers.set("Content-Type", item.mime || mimeOf(item.url));
          headers.set("Cache-Control", "public, max-age=31536000, immutable");
          headers.set("X-GC-Vendor", "1");
          await cache.put(request, new Response(item.body, { status: 200, headers }));
          count++;
        }
        e.ports?.[0]?.postMessage({ ok: true, count, cache: VENDOR_CACHE });
      })().catch((error) => e.ports?.[0]?.postMessage({ ok: false, error: String(error) }))
    );
    return;
  }
  if (data.type === "CLEAR_VENDOR") {
    e.waitUntil(caches.delete(VENDOR_CACHE).then(() => e.ports?.[0]?.postMessage({ ok: true })));
    return;
  }
  if (data.type === "CLEAR_ZIP") {
    e.waitUntil(
      caches.delete(ZIP_CACHE).then(() => {
        if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true });
      })
    );
    return;
  }
  if (data.type === "PUT_ZIP_ASSETS" && Array.isArray(data.assets)) {
    e.waitUntil(
      (async () => {
        const cache = await caches.open(ZIP_CACHE);
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
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-GC-Asset": "1"
          });
          const res = new Response(item.buffer, { status: 200, headers });
          await cache.put(url, res);
          // also store without nested encoding issues — bare path key
          n++;
        }
        if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true, count: n });
      })().catch((err) => {
        if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: false, error: String(err) });
      })
    );
  }
});

async function matchGcAsset(request, url) {
  const cache = await caches.open(ZIP_CACHE);
  let hit = await cache.match(request);
  if (hit) return hit;

  const rel = decodeURIComponent(url.pathname.slice("/__gc__/".length));
  hit = await cache.match(new URL("/__gc__/" + rel, self.location.origin).href);
  if (hit) return hit;

  // strip query on virtual path
  const noQuery = rel.split("?")[0];
  hit = await cache.match(new URL("/__gc__/" + noQuery, self.location.origin).href);
  if (hit) return hit;

  const bare = noQuery.split("/").pop();
  if (bare) {
    const keys = await cache.keys();
    for (const req of keys) {
      if (req.url.endsWith("/" + bare) || req.url.includes("/__gc__/" + bare)) {
        const r = await cache.match(req);
        if (r) return r;
      }
    }
  }
  return null;
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // App's own Worker API — never cache / never offline-block collect APIs
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    return;
  }

  // Vendor assets are cache-first and never require network in offline mode.
  if (url.pathname === "/vendor" || url.pathname.startsWith("/vendor/")) {
    e.respondWith(
      caches.open(VENDOR_CACHE).then((cache) =>
        cache.match(e.request).then((hit) => hit || fetch(e.request).then((response) => {
          if (response.ok) cache.put(e.request, response.clone());
          return response;
        }).catch(() => new Response("Offline: vendor asset not cached", { status: 503 })))
      )
    );
    return;
  }
  // Virtual ZIP assets — always from cache
  if (url.pathname.startsWith("/__gc__/")) {
    e.respondWith(
      (async () => {
        const hit = await matchGcAsset(e.request, url);
        if (hit) return hit;
        return new Response("GC asset not in cache: " + url.pathname, {
          status: 404,
          headers: { "Content-Type": "text/plain", "X-GC-Asset": "miss" }
        });
      })()
    );
    return;
  }

  // Cross-origin or same-origin game requests
  const sameOrigin = url.origin === self.location.origin;

  // Offline-strict: block API-like requests, try cache for static
  if (HYBRID_POLICY.mode === "offline") {
    if (e.request.method !== "GET" && e.request.method !== "HEAD") {
      if (isApiRequest(url)) {
        e.respondWith(offlineApiMock(url));
        return;
      }
    }
    if (isApiRequest(url)) {
      e.respondWith(offlineApiMock(url));
      return;
    }
    // static: try ZIP cache by basename as last resort
    if (isStaticAssetPath(url.pathname)) {
      e.respondWith(
        (async () => {
          const bare = url.pathname.split("/").pop();
          if (bare) {
            const cache = await caches.open(ZIP_CACHE);
            const keys = await cache.keys();
            for (const req of keys) {
              if (req.url.endsWith("/" + bare)) {
                const r = await cache.match(req);
                if (r) return r;
              }
            }
          }
          try {
            return await fetch(e.request);
          } catch {
            return new Response("Offline: asset not cached " + url.pathname, {
              status: 503,
              headers: { "Content-Type": "text/plain", "X-GC-Offline": "1" }
            });
          }
        })()
      );
      return;
    }
  }

  // Hybrid mode: network for API; cache-first for /__gc__ already handled
  // App shell: network-first
  if (sameOrigin && e.request.method === "GET") {
    e.respondWith(
      fetch(e.request, { cache: "no-store" })
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const clone = res.clone();
            caches.open(SHELL).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then((r) => r || new Response("Offline shell", { status: 503 })))
    );
  }
  // hybrid cross-origin: browser default (no respondWith) — network allowed
});
