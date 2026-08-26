export const TYPES = new Set([
  "document",
  "script",
  "stylesheet",
  "image",
  "media",
  "font",
  "xhr",
  "fetch"
]);

/** Status resource (spec): DOWNLOAD_FAILED ≠ API */
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
  DOWNLOAD_FAILED: "DOWNLOAD_FAILED",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  BACKEND: "BACKEND",
  DISCOVERED: "DISCOVERED",
  DOWNLOADED: "DOWNLOADED",
  VERIFIED: "VERIFIED"
};

const EXCLUDE = [
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /facebook\.net/i,
  /doubleclick\.net/i,
  /googlesyndication\.com/i,
  /hotjar\.com/i,
  /clarity\.ms/i,
  /segment\.(com|io)/i,
  /mixpanel\.com/i,
  /sentry\.io/i,
  /newrelic\.com/i,
  /fullstory\.com/i,
  /gtag\/js/i,
  /gtm\.js/i
];

const TRACKING_PATH = /\/(analytics|tracking|pixel|beacon|telemetry)(\/|$|\?)/i;

const SVG_NS = /^https?:\/\/www\.w3\.org\/2000\/svg/i;

const ASSET_EXT =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|mp3|ogg|wav|m4a|aac|mp4|webm|wasm|atlas|css|js|mjs)(\?|#|$)/i;

const API_PATH_HINTS = [
  "/api/",
  "/v1/",
  "/v2/",
  "/v3/",
  "/graphql",
  "/rest/",
  "/rpc/",
  "/auth/",
  "/oauth",
  "/token",
  "/session",
  "/verifysession",
  "/gamewallet",
  "/leaderboard",
  "/inventory",
  "/multiplayer",
  "/gateway"
];

const API_ACTION_HINTS =
  /\/(spin|bet|wager|balance|wallet|history|login|logout|register)\b/i;

export function isExcluded(url) {
  return EXCLUDE.some((r) => r.test(url)) || TRACKING_PATH.test(url);
}

function ctIsAsset(ct) {
  const c = (ct || "").toLowerCase();
  return (
    c.startsWith("image/") ||
    c.startsWith("audio/") ||
    c.startsWith("video/") ||
    c.startsWith("font/") ||
    c.includes("woff") ||
    c.includes("javascript") ||
    c.includes("ecmascript") ||
    c.includes("text/css") ||
    c.includes("wasm")
  );
}

function ctLooksJsonApi(ct) {
  const c = (ct || "").toLowerCase();
  return c.includes("json") || c.includes("xml");
}

/**
 * Klasifikasi: Content-Type → resource type → extension → path context.
 * JANGAN: domain saja → API (CDN + image = ASSET).
 *
 * @returns {{ category: "game"|"api"|"server", reason: string, status: string }}
 */
export function classifyResource(url, type, contentType, bodyText) {
  const ct = (contentType || "").toLowerCase();
  const u = String(url || "");
  const ul = u.toLowerCase();
  let pathname = "";
  let host = "";
  try {
    const parsed = new URL(u.startsWith("//") ? "https:" + u : u);
    pathname = parsed.pathname.toLowerCase();
    host = parsed.hostname.toLowerCase();
  } catch {
    /* ignore */
  }

  if (SVG_NS.test(u)) {
    return {
      category: "server",
      reason: "svg-namespace",
      status: STRICT_STATUS.SVG_NAMESPACE
    };
  }

  if (isExcluded(u) || isExcluded(host)) {
    return {
      category: "server",
      reason: "tracking",
      status: STRICT_STATUS.TRACKING
    };
  }

  // 1) Content-Type = sinyal utama
  if (ctIsAsset(ct)) {
    return {
      category: "game",
      reason: "content-type-asset:" + ct.split(";")[0],
      status: STRICT_STATUS.ASSET
    };
  }

  // 2) Browser resource type
  if (["image", "media", "font", "stylesheet"].includes(type)) {
    return {
      category: "game",
      reason: "static-type:" + type,
      status: STRICT_STATUS.ASSET
    };
  }

  // 3) Extension (CDN tanpa ekstensi di path tetap bisa lewat CT di atas)
  if (ASSET_EXT.test(pathname)) {
    return {
      category: "game",
      reason: "static-extension",
      status: STRICT_STATUS.ASSET
    };
  }

  // Socket
  if (/^wss?:\/\//i.test(u) || /websocket|socket\.io/i.test(ul)) {
    return {
      category: "api",
      reason: "websocket",
      status: STRICT_STATUS.SOCKET
    };
  }

  // Script bundles = game asset (kecuali path config API)
  if (type === "script") {
    if (/\/(config|settings|env|endpoint)s?\.(js|json)/i.test(pathname)) {
      return {
        category: "server",
        reason: "script-config",
        status: STRICT_STATUS.API
      };
    }
    return {
      category: "game",
      reason: "script-bundle",
      status: STRICT_STATUS.ASSET
    };
  }

  if (type === "document") {
    return {
      category: "game",
      reason: "document",
      status: STRICT_STATUS.ASSET
    };
  }

  // API: path + (opsional) JSON body — BUKAN host api.* saja
  const pathIsApi =
    API_PATH_HINTS.some((h) => pathname.includes(h) || ul.includes(h)) ||
    API_ACTION_HINTS.test(pathname);

  if (type === "xhr" || type === "fetch") {
    // XHR yang mengembalikan image/audio tetap asset (signed CDN)
    if (ctIsAsset(ct) || ASSET_EXT.test(pathname)) {
      return {
        category: "game",
        reason: "xhr-but-static-asset",
        status: STRICT_STATUS.ASSET
      };
    }
    if (pathIsApi || ctLooksJsonApi(ct)) {
      const sample = (bodyText || "").slice(0, 200).trim();
      if (
        ctLooksJsonApi(ct) ||
        sample.startsWith("{") ||
        sample.startsWith("[") ||
        pathIsApi
      ) {
        return {
          category: "api",
          reason: pathIsApi ? "path-api" : "xhr-json",
          status: STRICT_STATUS.API
        };
      }
    }
    // XHR tanpa sinyal kuat: jangan langsung API — UNKNOWN/game default hati-hati
    if (pathIsApi) {
      return {
        category: "api",
        reason: "path-api",
        status: STRICT_STATUS.API
      };
    }
    return {
      category: "game",
      reason: "xhr-unclassified-as-asset-candidate",
      status: STRICT_STATUS.UNKNOWN
    };
  }

  if (pathIsApi && !ASSET_EXT.test(pathname) && !ctIsAsset(ct)) {
    return {
      category: "api",
      reason: "path-hint",
      status: STRICT_STATUS.API
    };
  }

  // Host api.* HANYA jika path juga API-like atau JSON — bukan CDN static
  if (
    (host.startsWith("api.") || host.startsWith("api-") || host.split(".")[0] === "api") &&
    (pathIsApi || ctLooksJsonApi(ct)) &&
    !ASSET_EXT.test(pathname)
  ) {
    return {
      category: "api",
      reason: "api-host+path",
      status: STRICT_STATUS.API
    };
  }

  return {
    category: "game",
    reason: "default-asset",
    status: STRICT_STATUS.ASSET
  };
}

/**
 * Tandai kegagalan download — status jelas, BUKAN API.
 */
export function markDownloadFailed(url, httpStatus, error) {
  return {
    url,
    category: "game",
    reason: "download-failed",
    status: STRICT_STATUS.DOWNLOAD_FAILED,
    httpStatus: httpStatus || null,
    error: String(error || "").slice(0, 200),
    collectStatus: STRICT_STATUS.DOWNLOAD_FAILED
  };
}
