/**
 * Extract absolute (and resolvable relative) asset URLs from HTML/CSS/JS text.
 * Covers signed CDN (?sign=) even when embedded without clean quotes.
 */
export function extractReferencedUrls(text, baseUrl) {
  const found = new Set();
  if (!text) return found;

  const addAbs = (raw) => {
    if (!raw) return;
    let s = String(raw).trim();
    if (!s || s.startsWith("data:") || s.startsWith("blob:") || s.startsWith("#") || s.startsWith("javascript:")) return;
    // trim trailing junk from regex greed
    while (/[.,;:)\]}>]$/.test(s)) s = s.slice(0, -1);
    if (/google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|clarity\.ms/i.test(s)) return;
    if (/^https?:\/\/www\.w3\.org\//i.test(s)) return;
    try {
      const abs = new URL(s, baseUrl || "https://local.invalid/").href;
      if (!abs.startsWith("http://") && !abs.startsWith("https://")) return;
      found.add(abs);
    } catch {}
  };

  const patterns = [
    /(?:src|href|data-src|data-href|poster|srcset)\s*=\s*["']([^"']+)["']/gi,
    /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
    /image-set\(\s*['"]?([^'")]+)['"]?/gi,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /["']((?:https?:)?\/\/[^"']+\.(?:js|mjs|css|json|png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm|wasm|atlas|data)(?:\?[^"']*)?)["']/gi,
    /["'](\.?\.?\/[^"']+\.(?:js|mjs|css|json|png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm|wasm|atlas|data)(?:\?[^"']*)?)["']/gi,
    /["'](https?:\/\/[^"'\s]{12,})["']/gi,
    // Signed / static CDN without relying on surrounding quotes (minified HTML)
    /(?:https?:)?\/\/(?:static\.)?[a-z0-9.-]*eajzzxhro\.com\/[^\s"'<>)\\]+/gi,
    /(?:https?:)?\/\/static\.[a-z0-9.-]+\/[^\s"'<>)\\]+\.(?:png|jpe?g|gif|webp|js|css|json|mp3|ogg|woff2?)(?:\?[^\s"'<>)\\]*)?/gi,
    /(?:https?:)?\/\/public\.[a-z0-9.-]+\/[^\s"'<>)\\]+/gi
  ];

  for (const re of patterns) {
    const r = new RegExp(re.source, re.flags);
    let m;
    while ((m = r.exec(text)) !== null) {
      let raw = m[1] != null ? m[1] : m[0];
      if (!raw) continue;
      raw = String(raw).trim();
      if (raw.includes(",") && /srcset/i.test(String(re.source))) {
        raw.split(",").forEach((part) => addAbs(part.trim().split(/\s+/)[0]));
        continue;
      }
      addAbs(raw);
    }
  }

  return found;
}

export function guessTypeFromUrl(u, ct) {
  const p = (u || "").toLowerCase();
  const c = (ct || "").toLowerCase();
  if (c.includes("javascript") || /\.m?js(\?|$)/.test(p)) return "script";
  if (c.includes("css") || /\.css(\?|$)/.test(p)) return "stylesheet";
  if (c.includes("image") || /\.(png|jpe?g|gif|webp|svg|ico)(\?|$)/.test(p)) return "image";
  if (c.includes("font") || /\.(woff2?|ttf|otf)(\?|$)/.test(p)) return "font";
  if (c.includes("audio") || c.includes("video") || /\.(mp3|ogg|wav|mp4|webm)(\?|$)/.test(p)) return "media";
  if (c.includes("json") || /\.json(\?|$)/.test(p)) return "fetch";
  // signed image path often has extension before ?sign=
  if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(p)) return "image";
  return "fetch";
}

/** True if URL looks like a static game asset (should be downloaded offline). */
export function looksLikeStaticAsset(url) {
  const u = String(url || "").toLowerCase();
  if (!u.startsWith("http")) return false;
  if (/googletagmanager|google-analytics|doubleclick|facebook\.net|w3\.org\/2000\/svg/i.test(u)) return false;
  if (/\/web-api\/|\/game-api\/|verifysession|gamewallet|\/spin|\/balance\/get/i.test(u)) return false;
  if (/\.(png|jpe?g|gif|webp|svg|ico|js|mjs|css|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm|wasm|atlas|json)(\?|$)/i.test(u)) return true;
  if (/static\.|\/shared\/|\/pages\/static\//i.test(u)) return true;
  if (/eajzzxhro\.com\/\d+\//i.test(u)) return true;
  return false;
}
