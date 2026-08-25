/**
 * STRICT OFFLINE COLLECTOR
 * Implements the full pipeline from the "COLLECTOR OFFLINE GAME" specification.
 *
 * Pipeline:
 * LOAD ZIP → INDEX → SCAN → EXTRACT REFS → CLASSIFY → CHECK LOCAL
 * → DOWNLOAD (verify) → SAVE → MANIFEST → REWRITE → RESCAN → VALIDATE
 * → OFFLINE SCORE → FINAL REPORT
 *
 * Status values for every asset:
 *   LOCAL | DOWNLOADED | MISSING | FAILED | BACKEND | TRACKING | SVG_NAMESPACE | UNKNOWN
 */

import { createHash } from "node:crypto";

// ─── Magic bytes / file signatures ───────────────────────────────────────────
const SIGNATURES = [
  { type: "png",  bytes: [0x89, 0x50, 0x4e, 0x47], mime: "image/png" },
  { type: "jpeg", bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg" },
  { type: "gif",  bytes: [0x47, 0x49, 0x46, 0x38], mime: "image/gif" },
  { type: "webp", bytes: [0x52, 0x49, 0x46, 0x46], mime: "image/webp", extra: (b) => b.length > 11 && b[8] === 0x57 && b[9] === 0x45 },
  { type: "ogg",  bytes: [0x4f, 0x67, 0x67, 0x53], mime: "audio/ogg" },
  { type: "wav",  bytes: [0x52, 0x49, 0x46, 0x46], mime: "audio/wav", extra: (b) => b.length > 11 && b[8] === 0x57 && b[9] === 0x41 },
  { type: "mp3",  bytes: [0xff, 0xfb], mime: "audio/mpeg" },
  { type: "mp3",  bytes: [0x49, 0x44, 0x33], mime: "audio/mpeg" }, // ID3
  { type: "woff", bytes: [0x77, 0x4f, 0x46, 0x46], mime: "font/woff" },
  { type: "woff2",bytes: [0x77, 0x4f, 0x46, 0x32], mime: "font/woff2" },
  { type: "zip",  bytes: [0x50, 0x4b, 0x03, 0x04], mime: "application/zip" },
  { type: "wasm", bytes: [0x00, 0x61, 0x73, 0x6d], mime: "application/wasm" },
];

export function detectSignature(buffer) {
  if (!buffer || buffer.length < 4) return null;
  const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  for (const sig of SIGNATURES) {
    if (sig.bytes.every((v, i) => b[i] === v)) {
      if (sig.extra && !sig.extra(b)) continue;
      return { type: sig.type, mime: sig.mime };
    }
  }
  return null;
}

// ─── Classification ──────────────────────────────────────────────────────────
const TRACKING_HOSTS = [
  /google-analytics\.com/i, /googletagmanager\.com/i, /gtag\/js/i, /gtm\.js/i,
  /facebook\.net/i, /doubleclick\.net/i, /googlesyndication\.com/i,
  /hotjar\.com/i, /clarity\.ms/i, /segment\.(com|io)/i, /mixpanel\.com/i,
  /sentry\.io/i, /newrelic\.com/i, /fullstory\.com/i, /analytics/i,
  /tracking/i, /pixel/i, /beacon/i, /telemetry/i
];

const SVG_NAMESPACE = /^https?:\/\/www\.w3\.org\/2000\/svg/i;

const API_HINTS = [
  /\/api\//i, /\/v[1-9]\//i, /\/graphql/i, /\/rest\//i, /\/rpc\//i,
  /\/auth\//i, /\/oauth/i, /\/token/i, /\/session/i, /\/login/i,
  /\/spin\b/i, /\/bet\b/i, /\/balance/i, /\/wallet/i, /\/history/i,
  /websocket/i, /wss?:\/\//i, /socket\.io/i, /baseURL|baseUrl|endpoint/i
];

const ASSET_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|mp3|wav|ogg|m4a|woff2?|ttf|otf|json|css|js|mjs|wasm|atlas|mp4|webm)(\?|$)/i;

/**
 * Classify a single URL according to Rule 8–12 of the spec.
 * @returns {{ status: string, reason: string, category: string }}
 */
export function classifyUrl(rawUrl, opts = {}) {
  const url = String(rawUrl || "").trim();
  if (!url) return { status: "UNKNOWN", reason: "empty", category: "unknown" };

  // SVG namespace
  if (SVG_NAMESPACE.test(url)) {
    return { status: "SVG_NAMESPACE", reason: "w3c-svg", category: "ignore" };
  }

  // Protocol-relative or absolute external
  const isExternal = /^https?:\/\//i.test(url) || /^\/\//.test(url);
  if (!isExternal) {
    return { status: "LOCAL", reason: "relative-or-local", category: "local" };
  }

  let host = "", path = "";
  try {
    const u = new URL(url.startsWith("//") ? "https:" + url : url);
    host = u.hostname.toLowerCase();
    path = u.pathname;
  } catch {
    return { status: "UNKNOWN", reason: "invalid-url", category: "unknown" };
  }

  // Tracking
  if (TRACKING_HOSTS.some((re) => re.test(host) || re.test(url))) {
    return { status: "TRACKING", reason: "tracking-host", category: "tracking" };
  }

  // API / Backend / Socket
  if (API_HINTS.some((re) => re.test(url) || re.test(path))) {
    const isSocket = /wss?:\/\//i.test(url) || /websocket|socket\.io/i.test(url);
    return {
      status: isSocket ? "SOCKET" : "API",
      reason: isSocket ? "websocket" : "api-path",
      category: "backend"
    };
  }

  // Asset by extension
  if (ASSET_EXT.test(path) || ASSET_EXT.test(url)) {
    return { status: "ASSET", reason: "extension", category: "asset" };
  }

  // Content-type hint from caller
  if (opts.contentType) {
    const ct = opts.contentType.toLowerCase();
    if (/image|audio|font|video|wasm/.test(ct)) {
      return { status: "ASSET", reason: "content-type", category: "asset" };
    }
    if (/json|xml|text\/plain/.test(ct) && /api|xhr|fetch/.test(opts.type || "")) {
      return { status: "API", reason: "content-type-api", category: "backend" };
    }
  }

  return { status: "UNKNOWN", reason: "no-match", category: "unknown" };
}

// ─── Normalization ───────────────────────────────────────────────────────────
export function normalizeUrl(raw) {
  const url = String(raw || "").trim();
  if (!url) return null;
  try {
    const full = url.startsWith("//") ? "https:" + url : url;
    const u = new URL(full);
    const pathname = u.pathname;
    const basename = pathname.split("/").pop() || "asset";
    // Strip query from local filename
    const localName = basename.split("?")[0].split("#")[0] || "asset";
    return {
      original: url,
      origin: u.origin,
      path: pathname,
      query: u.search,
      localName: localName.replace(/[^\w.\-]+/g, "_") || "asset",
      href: u.href
    };
  } catch {
    return null;
  }
}

// ─── Hash ────────────────────────────────────────────────────────────────────
export function sha256(buffer) {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return createHash("sha256").update(data).digest("hex");
}

// ─── Download verification (Rule 17–21) ──────────────────────────────────────
/**
 * Validate a downloaded response.
 * @returns {{ ok: boolean, status: string, error?: string, size: number, contentType: string, signature?: object, hash?: string }}
 */
export function verifyDownload(res, buffer, expectedExt) {
  const size = buffer ? buffer.byteLength || buffer.length : 0;
  const contentType = (res.headers?.get?.("content-type") || res.contentType || "").toLowerCase();
  const httpStatus = res.status || res.statusCode || 0;

  if (httpStatus !== 200) {
    return { ok: false, status: "FAILED", error: `HTTP ${httpStatus}`, size, contentType };
  }
  if (size === 0) {
    return { ok: false, status: "INVALID", error: "empty-file", size, contentType };
  }

  // Content-type mismatch (HTML error page served as image)
  if (expectedExt && /image|audio|font/.test(expectedExt) && /text\/html|application\/json/.test(contentType)) {
    return { ok: false, status: "INVALID", error: "content-type-mismatch", size, contentType };
  }

  const signature = detectSignature(buffer);
  // Soft check: if signature exists and contradicts extension, warn but still accept
  let sigOk = true;
  if (signature && expectedExt) {
    const map = { png: "png", jpg: "jpeg", jpeg: "jpeg", gif: "gif", webp: "webp", mp3: "mp3", ogg: "ogg", wav: "wav", woff: "woff", woff2: "woff2" };
    const expect = map[expectedExt.replace(".", "").toLowerCase()];
    if (expect && signature.type !== expect && !(expect === "jpeg" && signature.type === "jpeg")) {
      sigOk = false;
    }
  }

  const hash = sha256(buffer);
  return {
    ok: true,
    status: "DOWNLOADED",
    size,
    contentType,
    signature: signature || undefined,
    signatureMatch: sigOk,
    hash
  };
}

// ─── Local existence check (Rule 13) ─────────────────────────────────────────
/**
 * Search ZIP index for a matching local file.
 * @param {Map|Object} zipIndex  path → size or path → true
 * @param {string} localName
 * @param {string} fullPathHint
 */
export function findLocalAsset(zipIndex, localName, fullPathHint) {
  const keys = zipIndex instanceof Map ? [...zipIndex.keys()] : Object.keys(zipIndex || {});
  const name = (localName || "").toLowerCase();
  const hint = (fullPathHint || "").toLowerCase();

  // exact path
  if (hint && keys.some((k) => k.toLowerCase() === hint || k.toLowerCase().endsWith("/" + hint))) {
    return keys.find((k) => k.toLowerCase() === hint || k.toLowerCase().endsWith("/" + hint));
  }
  // basename match
  const byBase = keys.filter((k) => {
    const b = k.split("/").pop().toLowerCase();
    return b === name || b === name.split("?")[0];
  });
  if (byBase.length === 1) return byBase[0];
  if (byBase.length > 1) {
    // prefer assets/ or images/
    const preferred = byBase.find((k) => /assets\/|images\/|audio\/|fonts\//i.test(k));
    return preferred || byBase[0];
  }
  // hash-token match (e.g. 39949c54de.346f3.png)
  const token = name.replace(/\.[^.]+$/, "").toLowerCase();
  if (token.length >= 8) {
    const hit = keys.find((k) => k.toLowerCase().includes(token));
    if (hit) return hit;
  }
  return null;
}

// ─── Offline Score (Rule 48) ─────────────────────────────────────────────────
/**
 * Compute offline readiness score 0–100 and status.
 */
export function computeOfflineScore(report) {
  let score = 100;
  const missing = report.missing || 0;
  const failed = report.failed || 0;
  const broken = report.brokenReferences || 0;
  const externalLeft = report.externalAssetsRemaining || 0;
  const tracking = report.tracking || 0;
  const api = report.api || 0;

  score -= missing * 12;
  score -= failed * 10;
  score -= broken * 8;
  score -= externalLeft * 6;
  score -= Math.min(tracking * 2, 10);
  score -= Math.min(api * 3, 15);

  if (!report.entryFileOk) score -= 30;
  score = Math.max(0, Math.min(100, score));

  let status = "OFFLINE READY";
  if (!report.entryFileOk || missing > 0 || broken > 3 || externalLeft > 5) {
    status = "OFFLINE FAILED";
  } else if (missing > 0 || broken > 0 || externalLeft > 0 || api > 0) {
    status = "OFFLINE PARTIAL";
  }

  return { score, status };
}

// ─── Final Report formatter (Rule 57) ────────────────────────────────────────
export function formatFinalReport(data) {
  const lines = [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    " OFFLINE COLLECTION REPORT",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `Files scanned       : ${data.totalFiles ?? "—"}`,
    "",
    `External URLs       : ${data.externalUrls ?? 0}`,
    `External assets     : ${data.externalAssets ?? 0}`,
    "",
    `Downloaded          : ${data.downloaded ?? 0}`,
    `Failed              : ${data.failed ?? 0}`,
    `Missing             : ${data.missing ?? 0}`,
    "",
    `Tracking            : ${data.tracking ?? 0}`,
    `SVG namespace       : ${data.svgNamespace ?? 0}`,
    `API/Backend         : ${data.api ?? 0}`,
    "",
    `Broken references   : ${data.brokenReferences ?? 0}`,
    "",
    `Service Worker      : ${data.serviceWorker || "—"}`,
    "",
    `Validation          : ${data.validation || "—"}`,
    "",
    `Offline Score       : ${data.offlineScore ?? "—"}`,
    `Status              : ${data.status || "—"}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  ];
  return lines.join("\n");
}

// ─── Main pipeline orchestrator (for Worker / Node) ──────────────────────────
/**
 * Run a strict pass over a list of candidate URLs against a ZIP index.
 * Does NOT download by itself — returns a plan + classification.
 *
 * @param {object} opts
 * @param {string[]} opts.urls
 * @param {Map|Object} opts.zipIndex
 * @param {boolean} [opts.strictMode=true]
 */
export function buildStrictPlan(opts = {}) {
  const { urls = [], zipIndex = {}, strictMode = true } = opts;
  const plan = {
    strictMode,
    assets: [],
    tracking: [],
    backend: [],
    svgNamespace: [],
    unknown: [],
    localFound: 0,
    needDownload: 0,
    report: {
      externalUrls: urls.length,
      externalAssets: 0,
      downloaded: 0,
      failed: 0,
      missing: 0,
      tracking: 0,
      svgNamespace: 0,
      api: 0,
      brokenReferences: 0
    }
  };

  const seen = new Set();
  for (const raw of urls) {
    const norm = normalizeUrl(raw);
    if (!norm) continue;
    const key = norm.href;
    if (seen.has(key)) continue;
    seen.add(key);

    const cls = classifyUrl(norm.href);
    const entry = {
      originalUrl: norm.original || norm.href,
      localName: norm.localName,
      path: norm.path,
      status: cls.status,
      reason: cls.reason,
      category: cls.category,
      localPath: null
    };

    if (cls.status === "TRACKING") {
      plan.tracking.push(entry);
      plan.report.tracking++;
      continue;
    }
    if (cls.status === "SVG_NAMESPACE") {
      plan.svgNamespace.push(entry);
      plan.report.svgNamespace++;
      continue;
    }
    if (cls.status === "API" || cls.status === "SOCKET") {
      plan.backend.push(entry);
      plan.report.api++;
      continue;
    }
    if (cls.status === "LOCAL") {
      plan.assets.push(entry);
      continue;
    }

    // ASSET or UNKNOWN → treat as potential asset
    plan.report.externalAssets++;
    const found = findLocalAsset(zipIndex, norm.localName, norm.path);
    if (found) {
      entry.status = "LOCAL";
      entry.localPath = found;
      plan.localFound++;
      plan.assets.push(entry);
    } else {
      entry.status = "MISSING";
      plan.needDownload++;
      plan.report.missing++;
      plan.assets.push(entry);
    }
  }

  return plan;
}

export default {
  classifyUrl,
  normalizeUrl,
  detectSignature,
  verifyDownload,
  findLocalAsset,
  sha256,
  computeOfflineScore,
  formatFinalReport,
  buildStrictPlan
};
