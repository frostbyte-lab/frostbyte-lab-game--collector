/**
 * Offline-first normalisasi nama file & URL (signed CDN).
 * Strip ?sign= & query lain → basename bersih.
 */
import { safe } from "../lib/safe.js";

/**
 * @param {string} url
 * @returns {{ cleanUrl: string, basename: string, pathname: string, hadQuery: boolean }}
 */
export function normalizeResourceUrl(url) {
  const raw = String(url || "");
  let pathname = "/file";
  let cleanUrl = raw;
  let hadQuery = false;
  try {
    const u = new URL(raw.startsWith("//") ? "https:" + raw : raw);
    pathname = u.pathname || "/file";
    hadQuery = Boolean(u.search);
    u.search = "";
    u.hash = "";
    cleanUrl = u.href;
  } catch {
    const noQ = raw.split("?")[0].split("#")[0];
    hadQuery = noQ !== raw;
    cleanUrl = noQ;
    pathname = noQ;
  }
  let basename = pathname.split("/").pop() || "file";
  basename = safe(basename.split("?")[0]) || "file";
  return { cleanUrl, basename, pathname, hadQuery };
}

/** Hash pendek stabil dari string (untuk nama profesional) */
function shortHash(s, n = 8) {
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, n);
}

function guessExt(type, contentType, basename) {
  const b = (basename || "").toLowerCase();
  const m = b.match(/\.([a-z0-9]{1,8})$/);
  if (m) return m[1];
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("png") || type === "image") return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("svg")) return "svg";
  if (ct.includes("javascript") || type === "script") return "js";
  if (ct.includes("css") || type === "stylesheet") return "css";
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.includes("woff2")) return "woff2";
  if (ct.includes("mp3") || ct.includes("mpeg")) return "mp3";
  if (ct.includes("ogg")) return "ogg";
  return "bin";
}

function rolePrefix(type, contentType, url) {
  const ct = (contentType || "").toLowerCase();
  const u = (url || "").toLowerCase();
  if (/balance|wallet|credit/i.test(u)) return "api-balance";
  if (/session|verifysession|auth/i.test(u)) return "api-session";
  if (/spin|bet|wager/i.test(u)) return "api-spin";
  if (/gameinfo|gamedata|init/i.test(u)) return "api-init";
  if (/GetByResources|resources/i.test(u)) return "api-resources";
  if (type === "image" || ct.startsWith("image/")) return "img";
  if (type === "script" || ct.includes("javascript")) return "js";
  if (type === "stylesheet" || ct.includes("css")) return "css";
  if (type === "font" || ct.includes("font")) return "font";
  if (type === "media" || ct.startsWith("audio/") || ct.startsWith("video/")) return "media";
  if (ct.includes("json") || type === "xhr" || type === "fetch") return "data";
  if (type === "document") return "html";
  return "asset";
}

/**
 * Nama file profesional: bukan UUID mentah.
 * Contoh: img-a1b2c3d4.png · api-balance-Get.json · js-bundle-9f0e1a2b.js
 */
export function professionalFileName(url, type, contentType, index) {
  const norm = normalizeResourceUrl(url);
  let base = norm.basename || "file";
  const ext = guessExt(type, contentType, base);
  const uuidLike =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(base) ||
    /^[0-9a-f]{32,}$/i.test(base.replace(/\./g, "")) ||
    base.length > 48;

  // API path segments → readable
  try {
    const path = norm.pathname || "";
    const segs = path.split("/").filter(Boolean);
    const last = segs[segs.length - 1] || "";
    if (/balance|session|spin|gameinfo|GetByResources|verifysession/i.test(path)) {
      const tag = last.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40) || "api";
      base = tag.includes(".") ? tag : tag + "." + (ext === "bin" ? "json" : ext);
    }
  } catch (_) {}

  if (uuidLike || base === "file" || base === "index") {
    const role = rolePrefix(type, contentType, url);
    const h = shortHash(norm.cleanUrl || url, 8);
    base = role + "-" + h + "." + ext;
  } else {
    // pastikan ada ekstensi
    if (!/\.[a-z0-9]{1,8}$/i.test(base)) {
      base = base + "." + ext;
    }
    base = safe(base) || rolePrefix(type, contentType, url) + "-" + shortHash(url, 6) + "." + ext;
  }

  const seq = String((index || 0) + 1).padStart(4, "0");
  return { name: seq + "-" + base, basename: base, ext, role: rolePrefix(type, contentType, url) };
}

/**
 * Folder preferensi offline-first (images/js/audio/data).
 */
export function preferredAssetDir(type, contentType, basename) {
  const ct = (contentType || "").toLowerCase();
  const b = (basename || "").toLowerCase();
  if (type === "image" || ct.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(b)) {
    return "assets/images";
  }
  if (type === "media" || ct.startsWith("audio/") || ct.startsWith("video/") || /\.(mp3|ogg|wav|m4a|mp4|webm)$/i.test(b)) {
    return "assets/audio";
  }
  if (type === "script" || ct.includes("javascript") || /\.(js|mjs)$/i.test(b)) {
    return "assets/js";
  }
  if (type === "stylesheet" || ct.includes("css") || /\.css$/i.test(b)) {
    return "assets/css";
  }
  if (ct.includes("json") || /\.json$/i.test(b) || /\.atlas$/i.test(b)) {
    return "assets/data";
  }
  if (type === "font" || ct.includes("font") || /\.(woff2?|ttf|otf)$/i.test(b)) {
    return "assets/fonts";
  }
  return null; // biarkan folderOf lama
}
