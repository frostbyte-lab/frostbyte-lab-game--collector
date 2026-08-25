export const TYPES = new Set(["document","script","stylesheet","image","media","font","xhr","fetch"]);

/** Strict status values (spec Rule 8) */
export const STRICT_STATUS = {
  ASSET: "ASSET",
  TRACKING: "TRACKING",
  API: "API",
  SOCKET: "SOCKET",
  SVG_NAMESPACE: "SVG_NAMESPACE",
  LOCAL: "LOCAL",
  UNKNOWN: "UNKNOWN",
  MISSING: "MISSING",
  FAILED: "FAILED",
  BACKEND: "BACKEND"
};

const EXCLUDE = [
  /google-analytics\.com/i,/googletagmanager\.com/i,/facebook\.net/i,
  /doubleclick\.net/i,/googlesyndication\.com/i,/hotjar\.com/i,
  /clarity\.ms/i,/segment\.(com|io)/i,/mixpanel\.com/i,/sentry\.io/i,
  /newrelic\.com/i,/fullstory\.com/i,/gtag\/js/i,/gtm\.js/i,
  /analytics/i,/tracking/i,/pixel/i,/beacon/i,/telemetry/i
];

const SVG_NS = /^https?:\/\/www\.w3\.org\/2000\/svg/i;

export function isExcluded(url) {
  return EXCLUDE.some(r => r.test(url));
}

/**
 * Klasifikasi: game asset vs API/server (legacy + strict status)
 * Returns { category: "game"|"api"|"server", reason, status?: STRICT_STATUS }
 */
export function classifyResource(url, type, contentType, bodyText) {
  const ct = (contentType || "").toLowerCase();
  const u = String(url || "").toLowerCase();
  let pathname = "";
  let host = "";
  try {
    const parsed = new URL(url.startsWith("//") ? "https:" + url : url);
    pathname = parsed.pathname.toLowerCase();
    host = parsed.hostname.toLowerCase();
  } catch {}

  // SVG namespace → ignore
  if (SVG_NS.test(url)) {
    return { category: "server", reason: "svg-namespace", status: STRICT_STATUS.SVG_NAMESPACE };
  }

  // Tracking → skip
  if (isExcluded(url) || isExcluded(host)) {
    return { category: "server", reason: "tracking", status: STRICT_STATUS.TRACKING };
  }

  // Static game assets
  if (["image", "media", "font", "stylesheet"].includes(type)) {
    return { category: "game", reason: "static-asset:" + type, status: STRICT_STATUS.ASSET };
  }
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp3|ogg|wav|m4a|mp4|webm|wasm)(\?|$)/i.test(pathname)) {
    return { category: "game", reason: "static-extension", status: STRICT_STATUS.ASSET };
  }

  // Socket
  if (/^wss?:\/\//i.test(url) || /websocket|socket\.io/i.test(u)) {
    return { category: "api", reason: "websocket", status: STRICT_STATUS.SOCKET };
  }

  // API / server signals
  const apiPathHints = [
    "/api/", "/v1/", "/v2/", "/v3/", "/graphql", "/rest/", "/rpc/",
    "/auth/", "/login", "/oauth", "/token", "/session",
    "/user/", "/users/", "/player/", "/profile",
    "/leaderboard", "/score", "/save", "/load", "/inventory",
    "/match", "/room", "/multiplayer", "/socket",
    "/config.json", "/settings", "/gateway",
    "/spin", "/bet", "/balance", "/wallet", "/history"
  ];
  if (apiPathHints.some(h => pathname.includes(h) || u.includes(h))) {
    return { category: "api", reason: "path-hint", status: STRICT_STATUS.API };
  }
  if (type === "xhr" || type === "fetch") {
    if (ct.includes("json") || ct.includes("text/plain") || ct.includes("xml") || ct.includes("javascript")) {
      if (ct.includes("json") || ct.includes("xml")) {
        return { category: "api", reason: "xhr-json", status: STRICT_STATUS.API };
      }
      const sample = (bodyText || "").slice(0, 200).trim();
      if (sample.startsWith("{") || sample.startsWith("[")) {
        return { category: "api", reason: "body-json", status: STRICT_STATUS.API };
      }
    }
    return { category: "api", reason: "xhr-fetch", status: STRICT_STATUS.API };
  }

  // Script: large app bundles = game; small config-like = maybe server
  if (type === "script") {
    if (/config|settings|env|endpoint|api[-_]?url/i.test(pathname)) {
      return { category: "server", reason: "script-config", status: STRICT_STATUS.API };
    }
    return { category: "game", reason: "script-bundle", status: STRICT_STATUS.ASSET };
  }

  if (type === "document") {
    return { category: "game", reason: "document", status: STRICT_STATUS.ASSET };
  }

  // Host berbeda dari page sering CDN asset (game) atau API subdomain
  if (host.startsWith("api.") || host.startsWith("api-") || host.split(".")[0] === "api") {
    return { category: "api", reason: "api-host", status: STRICT_STATUS.API };
  }

  return { category: "game", reason: "default", status: STRICT_STATUS.ASSET };
}
