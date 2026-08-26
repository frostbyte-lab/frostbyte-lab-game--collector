export function extractReferencedUrls(text, baseUrl) {
  const found = new Set();
  if (!text) return found;
  const patterns = [
    /(?:src|href|data-src|data-href|poster|srcset)\s*=\s*["']([^"']+)["']/gi,
    /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
    /image-set\(\s*['"]?([^'")]+)['"]?/gi,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /["']((?:https?:)?\/\/[^"']+\.(?:js|mjs|css|json|png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm|wasm|atlas|data))["']/gi,
    /["'](\.?\.?\/[^"']+\.(?:js|mjs|css|json|png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm|wasm|atlas|data))["']/gi,
    // Absolute URL di JSON/JS (signed CDN sering tanpa ekstensi di query)
    /["'](https?:\/\/[^"'\s]{12,})["']/gi
  ];
  for (const re of patterns) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(text)) !== null) {
      let raw = (m[1] || "").trim();
      if (!raw || raw.startsWith("data:") || raw.startsWith("blob:") || raw.startsWith("#") || raw.startsWith("javascript:")) continue;
      // srcset: "a.png 1x, b.png 2x"
      if (raw.includes(",")) {
        raw.split(",").forEach((part) => {
          const bit = part.trim().split(/\s+/)[0];
          if (bit) {
            try {
              const abs = new URL(bit, baseUrl).href;
              if (abs.startsWith("http://") || abs.startsWith("https://")) found.add(abs);
            } catch {}
          }
        });
        continue;
      }
      try {
        const abs = new URL(raw, baseUrl).href;
        if (!abs.startsWith("http://") && !abs.startsWith("https://")) continue;
        // skip pure tracking hosts early
        if (/google-analytics|googletagmanager|doubleclick|facebook\.net/i.test(abs)) continue;
        found.add(abs);
      } catch {}
    }
  }
  return found;
}

export function guessTypeFromUrl(u, ct) {
  const p = u.toLowerCase();
  if (ct.includes("javascript") || /\.m?js(\?|$)/.test(p)) return "script";
  if (ct.includes("css") || /\.css(\?|$)/.test(p)) return "stylesheet";
  if (ct.includes("image") || /\.(png|jpe?g|gif|webp|svg|ico)(\?|$)/.test(p)) return "image";
  if (ct.includes("font") || /\.(woff2?|ttf|otf)(\?|$)/.test(p)) return "font";
  if (ct.includes("audio") || ct.includes("video") || /\.(mp3|ogg|wav|mp4|webm)(\?|$)/.test(p)) return "media";
  if (ct.includes("json") || /\.json(\?|$)/.test(p)) return "fetch";
  return "fetch";
}
