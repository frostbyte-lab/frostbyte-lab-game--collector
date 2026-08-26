/**
 * Opsi 2 — HYBRID offline fix
 * - TRACKING (GTM/gtag) → HAPUS script
 * - SVG namespace (w3.org/2000/svg) → BIARKAN
 * - Signed CDN (static.eajzzxhro.com … ?sign=) → DOWNLOAD lokal + rewrite path
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
  /(?:https?:)?\/\/[a-z0-9.-]+\/[^\s"'<>)\\]+\.(?:png|jpe?g|gif|webp|svg|mp3|ogg|woff2?)(?:\?[^\s"'<>)\\]*)?/gi;

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

/**
 * Extract absolute signed CDN / image URLs from text
 */
export function extractHybridAssetUrls(text) {
  const found = new Set();
  if (!text) return found;
  const patterns = [SIGNED_CDN_RE, GENERIC_SIGNED_ASSET_RE];
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

/**
 * Remove tracking scripts only (keep SVG xmlns).
 */
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

/**
 * Rewrite URL → local path in text (exact match, then no-query basename).
 */
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
  // remaining signed same-basename
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
  return { text: out, hits };
}

/**
 * Download one URL → Uint8Array (Worker-safe fetch)
 */
async function fetchBinary(url, referer) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      Referer: referer || new URL(url).origin + "/"
    }
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.byteLength) throw new Error("empty");
  return { buffer: buf, contentType: res.headers.get("content-type") || "" };
}

/**
 * Apply hybrid fix on zipFiles + manifest.
 * @returns {{ trackingRemoved, downloaded, rewritten, failed, map }}
 */
export async function applyHybridCdnFix(zipFiles, manifest, opts = {}) {
  const report = {
    trackingRemoved: 0,
    downloaded: 0,
    rewritten: 0,
    failed: [],
    map: {},
    option: "HYBRID"
  };
  const dir = opts.assetDir || "assets/eajzz";
  const baseUrl =
    opts.baseUrl ||
    (manifest && manifest[0] && manifest[0].url) ||
    "";

  // Collect candidate URLs from all text files
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

  // Prefer URLs already on manifest (fresh sign from collect)
  for (const r of manifest || []) {
    if (!r.url) continue;
    if (/eajzzxhro\.com/i.test(r.url) && /\.(png|jpe?g|webp|gif)/i.test(r.url)) {
      candidates.add(r.url);
    }
  }

  const urlToLocal = new Map();

  // Map already-local files by basename
  for (const [path, data] of Object.entries(zipFiles || {})) {
    if (!/\.(png|jpe?g|gif|webp)$/i.test(path)) continue;
    const base = path.split("/").pop().toLowerCase();
    const stripped = base.replace(/^\d{2,6}-/, "");
    for (const u of candidates) {
      const b = basenameFromUrl(u).toLowerCase();
      if (b === base || b === stripped || base.endsWith(b)) {
        urlToLocal.set(u, path);
        urlToLocal.set(u.split("?")[0], path);
      }
    }
  }

  // Download missing
  for (const u of candidates) {
    if (urlToLocal.has(u) || urlToLocal.has(u.split("?")[0])) continue;
    const base = basenameFromUrl(u);
    try {
      const { buffer } = await fetchBinary(u, baseUrl);
      const localPath = uniqueLocalPath(zipFiles, dir, base);
      zipFiles[localPath] = buffer;
      urlToLocal.set(u, localPath);
      urlToLocal.set(u.split("?")[0], localPath);
      report.downloaded++;
      report.map[u.slice(0, 120)] = localPath;
      if (manifest) {
        manifest.push({
          url: u,
          type: "image",
          localPath,
          size: buffer.byteLength,
          category: "game",
          classifyReason: "hybrid-cdn-download",
          collectStatus: "DOWNLOADED"
        });
      }
    } catch (e) {
      report.failed.push({ url: u.slice(0, 200), error: String(e.message || e) });
    }
  }

  // Rewrite + strip tracking on text files
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
      /* skip binary */
    }
  }

  return report;
}
