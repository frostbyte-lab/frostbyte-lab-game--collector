/**
 * Opsi 2 — HYBRID offline fix
 * - TRACKING (GTM/gtag) → HAPUS script
 * - SVG namespace (w3.org/2000/svg) → BIARKAN
 * - Signed CDN (static.eajzzxhro.com … ?sign=) → DOWNLOAD lokal + rewrite path
 * - Tolak body palsu (< 200B / HTML) agar tidak jadi PNG kosong 116B
 */
import { strToU8 } from "fflate";
import { safe } from "../lib/safe.js";

const TRACKING_SCRIPT_RE =
  /<script\b[^>]*\bsrc\s*=\s*["'][^"']*(?:googletagmanager|google-analytics|gtag\/js|gtm\.js|facebook\.net|hotjar|clarity\.ms)[^"']*["'][^>]*>\s*<\/script>/gi;
const TRACKING_INLINE_RE =
  /<script\b[^>]*>[\s\S]*?(?:googletagmanager|gtag\s*\(|GoogleAnalyticsObject|GTM-)[\s\S]*?<\/script>/gi;

const SIGNED_CDN_RE =
  /(?:https?:)?\/\/(?:static\.)?[a-z0-9.-]*eajzzxhro\.com\/[^\s"'<>)\\]+/gi;
const GENERIC_SIGNED_ASSET_RE =
  /(?:https?:)?\/\/[a-z0-9.-]+\/[^\s"'<>)\\]+\.(?:png|jpe?g|gif|webp|svg|mp3|ogg|woff2?|js|css|json)(?:\?[^\s"'<>)\\]*)?/gi;
const PUBLIC_CDN_RE =
  /(?:https?:)?\/\/public\.[a-z0-9.-]+\/[^\s"'<>)\\]+/gi;

const MIN_REAL_ASSET_BYTES = 200;

function basenameFromUrl(url) {
  try {
    const u = new URL(url.startsWith("//") ? "https:" + url : url);
    return (u.pathname.split("/").pop() || "asset").split("?")[0];
  } catch {
    return String(url).split("?")[0].split("/").pop() || "asset";
  }
}

function uniqueLocalPath(zipFiles, preferredDir, baseName) {
  const dir = preferredDir.replace(/\/+$/, "");
  let name = safe(baseName) || "asset.png";
  if (!/\.[a-z0-9]{1,8}$/i.test(name)) name += ".png";
  let path = `${dir}/${name}`;
  let n = 0;
  while (zipFiles[path] && n < 50) {
    n++;
    const parts = name.split(".");
    const ext = parts.length > 1 ? parts.pop() : "png";
    const stem = parts.join(".") || "asset";
    path = `${dir}/${stem}-${n}.${ext}`;
  }
  return path;
}

export function extractHybridAssetUrls(text) {
  const found = new Set();
  if (!text) return found;
  const patterns = [SIGNED_CDN_RE, GENERIC_SIGNED_ASSET_RE, PUBLIC_CDN_RE];
  for (const re of patterns) {
    const r = new RegExp(re.source, re.flags);
    let m;
    while ((m = r.exec(text)) !== null) {
      let u = m[0];
      while (/[.,;:)]$/.test(u)) u = u.slice(0, -1);
      if (/googletagmanager|google-analytics|w3\.org\/2000\/svg/i.test(u)) continue;
      if (/^https?:\/\/www\.w3\.org\//i.test(u)) continue;
      found.add(u.startsWith("//") ? "https:" + u : u);
    }
  }
  return found;
}

export function stripTrackingScripts(text) {
  let n = 0;
  let out = String(text || "");
  out = out.replace(TRACKING_SCRIPT_RE, () => {
    n++;
    return "<!-- GC hybrid: tracking script removed -->";
  });
  out = out.replace(TRACKING_INLINE_RE, () => {
    n++;
    return "<!-- GC hybrid: tracking inline removed -->";
  });
  return { text: out, removed: n };
}

export function rewriteUrlsInText(text, urlToLocal) {
  let out = String(text || "");
  let hits = 0;
  const entries = [...urlToLocal.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of entries) {
    if (!from || !to) continue;
    if (out.includes(from)) {
      const parts = out.split(from);
      hits += parts.length - 1;
      out = parts.join(to);
    }
  }
  out = out.replace(SIGNED_CDN_RE, (match) => {
    let u = match;
    while (/[.,;:)]$/.test(u)) u = u.slice(0, -1);
    const base = basenameFromUrl(u).toLowerCase();
    for (const [, local] of urlToLocal) {
      const lb = String(local).split("/").pop().toLowerCase();
      if (lb === base || lb.endsWith("-" + base) || lb.replace(/^\d+-/, "") === base) {
        hits++;
        return local;
      }
    }
    return match;
  });
  out = out.replace(GENERIC_SIGNED_ASSET_RE, (match) => {
    let u = match;
    while (/[.,;:)]$/.test(u)) u = u.slice(0, -1);
    if (/googletagmanager|w3\.org/i.test(u)) return match;
    const base = basenameFromUrl(u).toLowerCase();
    for (const [, local] of urlToLocal) {
      const lb = String(local).split("/").pop().toLowerCase();
      if (lb === base || lb.replace(/^\d+-/, "") === base) {
        hits++;
        return local;
      }
    }
    return match;
  });
  return { text: out, hits };
}

function isRealAssetBuffer(buf, url) {
  if (!buf || buf.byteLength < MIN_REAL_ASSET_BYTES) return false;
  // reject HTML error pages saved as "png"
  const head = String.fromCharCode(...buf.slice(0, 64)).toLowerCase();
  if (head.includes("<!doctype") || head.includes("<html") || head.includes("access denied")) return false;
  const u = (url || "").toLowerCase();
  if (/\.png(\?|$)/.test(u) || true) {
    // soft: if claims png, prefer magic; still allow other binary
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
    const isGif = buf[0] === 0x47 && buf[1] === 0x49;
    const isWebp = buf[0] === 0x52 && buf[8] === 0x57;
    if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(u)) {
      return isPng || isJpg || isGif || isWebp;
    }
  }
  return buf.byteLength >= MIN_REAL_ASSET_BYTES;
}

async function fetchBinary(url, referer) {
  let ref = referer || "";
  let ua =
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (/eajzzxhro\.com/i.test(host)) {
      ref = "https://m.eajzzxhro.com/";
    } else if (/^static\./i.test(host)) {
      ref = "https://m." + host.replace(/^static\./i, "") + "/";
    } else if (!ref) {
      ref = new URL(url).origin + "/";
    }
  } catch {
    if (!ref) ref = "https://m.eajzzxhro.com/";
  }

  const attempts = [
    { Referer: ref, Origin: ref.replace(/\/$/, "") },
    { Referer: "https://m.pgsoft-games.com/", Origin: "https://m.pgsoft-games.com" },
    { Referer: new URL(url).origin + "/", Origin: new URL(url).origin }
  ];

  let lastErr = "fetch failed";
  for (const h of attempts) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": ua,
          Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
          Referer: h.Referer,
          Origin: h.Origin
        }
      });
      if (!res.ok) {
        lastErr = "HTTP " + res.status;
        continue;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (!isRealAssetBuffer(buf, url)) {
        lastErr = "invalid/empty body " + buf.byteLength + "B";
        continue;
      }
      return { buffer: buf, contentType: res.headers.get("content-type") || "" };
    } catch (e) {
      lastErr = String(e.message || e);
    }
  }
  throw new Error(lastErr);
}

/**
 * Apply hybrid fix on zipFiles + manifest.
 */
export async function applyHybridCdnFix(zipFiles, manifest, opts = {}) {
  const report = {
    trackingRemoved: 0,
    downloaded: 0,
    rewritten: 0,
    failed: [],
    skippedTiny: 0,
    map: {},
    option: "HYBRID",
    minBytes: MIN_REAL_ASSET_BYTES
  };
  const dir = opts.assetDir || "assets/eajzz";
  const baseUrl =
    opts.baseUrl ||
    (manifest && manifest[0] && manifest[0].url) ||
    "";
  const maxDownload = Math.min(120, Number(opts.maxDownload) || 80);

  const candidates = new Set();
  for (const [key, data] of Object.entries(zipFiles || {})) {
    if (!/\.(html?|js|mjs|css|json)$/i.test(key) && key !== "index.html") continue;
    try {
      const text = new TextDecoder().decode(data);
      for (const u of extractHybridAssetUrls(text)) candidates.add(u);
    } catch {
      /* skip */
    }
  }

  for (const r of manifest || []) {
    if (!r.url) continue;
    if (
      (/\.(png|jpe?g|webp|gif|js|css|mp3|ogg|woff2?)(\?|$)/i.test(r.url) ||
        /static\.|public\.|eajzzxhro/i.test(r.url)) &&
      !/web-api|game-api|verifysession/i.test(r.url)
    ) {
      candidates.add(r.url);
    }
  }

  const urlToLocal = new Map();

  // Map already-local files by basename (skip tiny placeholders)
  for (const [path, data] of Object.entries(zipFiles || {})) {
    if (!/\.(png|jpe?g|gif|webp|js|css|mp3|ogg|woff2?)$/i.test(path)) continue;
    const size = data && data.byteLength != null ? data.byteLength : 0;
    if (size > 0 && size < MIN_REAL_ASSET_BYTES) {
      // remove fake placeholder so we can re-download
      try {
        delete zipFiles[path];
        report.skippedTiny++;
      } catch {}
      continue;
    }
    const base = path.split("/").pop().toLowerCase();
    const stripped = base.replace(/^\d{2,6}-/, "");
    for (const u of candidates) {
      const b = basenameFromUrl(u).toLowerCase();
      if (b === base || b === stripped || base.endsWith(b) || base.includes(b.replace(/\.[a-z0-9]+$/, ""))) {
        urlToLocal.set(u, path);
        urlToLocal.set(u.split("?")[0], path);
      }
    }
  }

  let dl = 0;
  for (const u of candidates) {
    if (dl >= maxDownload) break;
    if (urlToLocal.has(u) || urlToLocal.has(u.split("?")[0])) continue;
    const base = basenameFromUrl(u);
    try {
      const { buffer } = await fetchBinary(u, baseUrl);
      const localPath = uniqueLocalPath(zipFiles, dir, base);
      zipFiles[localPath] = buffer;
      urlToLocal.set(u, localPath);
      urlToLocal.set(u.split("?")[0], localPath);
      report.downloaded++;
      report.map[u.slice(0, 140)] = localPath;
      dl++;
      if (manifest) {
        manifest.push({
          url: u,
          type: "image",
          localPath,
          size: buffer.byteLength,
          category: "game",
          classifyReason: "hybrid-cdn-download",
          collectStatus: "VERIFIED"
        });
      }
    } catch (e) {
      report.failed.push({ url: u.slice(0, 200), error: String(e.message || e) });
    }
  }

  for (const key of Object.keys(zipFiles || {})) {
    if (!/\.(html?|js|mjs|css|json)$/i.test(key) && key !== "index.html") continue;
    try {
      let text = new TextDecoder().decode(zipFiles[key]);
      const strip = stripTrackingScripts(text);
      text = strip.text;
      report.trackingRemoved += strip.removed;
      const rw = rewriteUrlsInText(text, urlToLocal);
      text = rw.text;
      report.rewritten += rw.hits;
      zipFiles[key] = strToU8(text);
    } catch {
      /* skip */
    }
  }

  return report;
}
