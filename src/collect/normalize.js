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
