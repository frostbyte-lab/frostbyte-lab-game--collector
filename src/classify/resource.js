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

/** CDN static known PG / game asset hosts — always ASSET if path is media */
const SIGNED_CDN_HOSTS = [
  /static\.eajzzxhro\.com/i,
  /static\.[a-z0-9-]+\.com/i,
  /cdn\.[a-z0-9-]+\./i,
  /assets\.[a-z0-9-]+\./i,
  /img\.[a-z0-9-]+\./i,
  /media\.[a-z0-9-]+\./i
];

function isSignedAssetUrl(url, pathname) {
  const u = String(url || "");
  // ?sign= / ?Signature= / ?token= on media path = signed CDN asset, NEVER API
  if (
    /[?&](sign|signature|sig|token|Expires|X-Amz-Signature)=/i.test(u) &&
    ASSET_EXT.test(pathname || u)
  ) {
    return true;
  }
  if (SIGNED_CDN_HOSTS.some((re) => re.test(u)) && ASSET_EXT.test(pathname || u)) {
    return true;
  }
  return false;
}

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

  // 0) Signed CDN / static media — GAME ASSET (bukan API meski ada ?sign=)
  if (isSignedAssetUrl(u, pathname)) {
    return {
      category: "game",
      reason: "signed-cdn-asset",
      status: STRICT_STATUS.ASSET
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

  // 2) Browser resource type — SCRIPT / STYLE terpisah (offline-first enum)
  if (type === "stylesheet") {
    return { category: "style", reason: "static-type:stylesheet", status: STRICT_STATUS.ASSET };
  }
  if (["image", "media", "font"].includes(type)) {
    return {
      category: "game",
      reason: "static-type:" + type,
      status: STRICT_STATUS.ASSET
    };
  }

  // 3) Extension
  if (/\.json(\?|#|$)/i.test(pathname) && !API_PATH_HINTS.some((h) => pathname.includes(h))) {
    return { category: "data", reason: "json-data", status: STRICT_STATUS.ASSET };
  }
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
      category: "script",
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

  // JSON / config data (xhr sering JSON)
  if (
    (type === "xhr" || type === "fetch") &&
    (ct.includes("json") || /\.json(\?|$)/i.test(pathname)) &&
    !API_PATH_HINTS.some((h) => pathname.includes(h))
  ) {
    // non-API JSON (atlas, locale, config static)
    if (!API_ACTION_HINTS.test(pathname) && ASSET_EXT.test(pathname + ".json")) {
      /* fall through */
    }
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
