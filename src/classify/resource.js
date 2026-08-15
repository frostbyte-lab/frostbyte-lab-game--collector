export const TYPES = new Set(["document","script","stylesheet","image","media","font","xhr","fetch"]);

const EXCLUDE = [
  /google-analytics\.com/i,/googletagmanager\.com/i,/facebook\.net/i,
  /doubleclick\.net/i,/googlesyndication\.com/i,/hotjar\.com/i,
  /clarity\.ms/i,/segment\.(com|io)/i,/mixpanel\.com/i,/sentry\.io/i,
  /newrelic\.com/i,/fullstory\.com/i
];

export function isExcluded(url) {
  return EXCLUDE.some(r => r.test(url));
}

/** Klasifikasi: game asset vs API/server */
export function classifyResource(url, type, contentType, bodyText) {
  const ct = (contentType || "").toLowerCase();
  const u = String(url || "").toLowerCase();
  let pathname = "";
  let host = "";
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname.toLowerCase();
    host = parsed.hostname.toLowerCase();
  } catch {}

  // Static game assets
  if (["image", "media", "font", "stylesheet"].includes(type)) {
    return { category: "game", reason: "static-asset:" + type };
  }
  if (/\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm|wasm)(\?|$)/i.test(pathname)) {
    return { category: "game", reason: "static-extension" };
  }

  // API / server signals
  const apiPathHints = [
    "/api/", "/v1/", "/v2/", "/v3/", "/graphql", "/rest/", "/rpc/",
    "/auth/", "/login", "/oauth", "/token", "/session",
    "/user/", "/users/", "/player/", "/profile",
    "/leaderboard", "/score", "/save", "/load", "/inventory",
    "/match", "/room", "/multiplayer", "/socket",
    "/config.json", "/settings", "/gateway"
  ];
  if (apiPathHints.some(h => pathname.includes(h) || u.includes(h))) {
    return { category: "api", reason: "path-hint" };
  }
  if (type === "xhr" || type === "fetch") {
    if (ct.includes("json") || ct.includes("text/plain") || ct.includes("xml") || ct.includes("javascript")) {
      // JSON dari fetch sering API; JS bundle besar = game
      if (ct.includes("json") || ct.includes("xml")) {
        return { category: "api", reason: "xhr-json" };
      }
      // body peek
      const sample = (bodyText || "").slice(0, 200).trim();
      if (sample.startsWith("{") || sample.startsWith("[")) {
        return { category: "api", reason: "body-json" };
      }
    }
    return { category: "api", reason: "xhr-fetch" };
  }

  // Script: large app bundles = game; small config-like = maybe server
  if (type === "script") {
    if (/config|settings|env|endpoint|api[-_]?url/i.test(pathname)) {
      return { category: "server", reason: "script-config" };
    }
    return { category: "game", reason: "script-bundle" };
  }

  if (type === "document") {
    return { category: "game", reason: "document" };
  }

  // Host berbeda dari page sering CDN asset (game) atau API subdomain
  if (host.startsWith("api.") || host.startsWith("api-") || host.split(".")[0] === "api") {
    return { category: "api", reason: "api-host" };
  }

  return { category: "game", reason: "default" };
}
