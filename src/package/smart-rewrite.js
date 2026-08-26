import { strToU8 } from "fflate";

const FRAME_BUSTER_RE = [
  /if\s*\(\s*(?:window\.)?top\s*!==?\s*(?:window\.)?(?:self|this)\s*\)/gi,
  /if\s*\(\s*(?:window\.)?self\s*!==?\s*(?:window\.)?top\s*\)/gi,
  /if\s*\(\s*(?:window\.)?parent\s*!==?\s*(?:window\.)?(?:self|this|window)\s*\)/gi,
  /top\.location\s*=/gi,
  /parent\.location\s*=/gi,
  /top\.location\.href\s*=/gi,
  /parent\.location\.href\s*=/gi,
  /window\.top\.location/gi,
  /if\s*\(\s*window\s*!==\s*window\.top\s*\)/gi,
  /if\s*\(\s*top\s*!=\s*self\s*\)/gi
];

export function neutralizeFrameBusters(text) {
  let out = text;
  let n = 0;
  for (const re of FRAME_BUSTER_RE) {
    out = out.replace(re, (m) => {
      n++;
      return "/* GC-PRO */ false && " + m;
    });
  }
  return { text: out, count: n };
}

/**
 * Build rich URL → localPath map for rewrite.
 * Includes: full URL, no-query, pathname, basename, protocol-relative.
 */
export function buildUrlToLocalMap(manifest) {
  const map = new Map();
  const add = (k, localPath) => {
    if (!k || !localPath) return;
    const key = String(k);
    if (key.length < 2) return;
    if (!map.has(key)) map.set(key, localPath);
  };

  for (const r of manifest || []) {
    if (!r.url || !r.localPath) continue;
    const localPath = r.localPath;
    add(r.url, localPath);
    try {
      const u = new URL(r.url);
      add(u.href, localPath);
      add(u.origin + u.pathname, localPath);
      add(u.origin + u.pathname + u.search, localPath);
      add("//" + u.host + u.pathname + u.search, localPath);
      add("//" + u.host + u.pathname, localPath);
      add(u.pathname + u.search, localPath);
      add(u.pathname, localPath);
      // path without leading slash
      if (u.pathname.startsWith("/")) add(u.pathname.slice(1), localPath);

      const bare = u.pathname.split("/").pop() || "";
      if (bare && bare.length > 2) {
        add(bare, localPath);
        add(bare + u.search, localPath);
        // hash-like name without query noise
        const bareNoQuery = bare.split("?")[0];
        add(bareNoQuery, localPath);
      }

      // tail-2 / tail-3 for unique CDN paths like /104/xxx.png
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs.length >= 2) add(segs.slice(-2).join("/"), localPath);
      if (segs.length >= 3) add(segs.slice(-3).join("/"), localPath);

      try {
        const dec = decodeURIComponent(u.pathname);
        if (dec !== u.pathname) {
          add(dec, localPath);
          add(u.origin + dec, localPath);
        }
      } catch {}
    } catch {}
  }
  return map;
}

/** Basename → localPath (last write wins only if unique; prefer first) */
function buildBareMap(urlMap) {
  const bareMap = new Map();
  const collisions = new Set();
  for (const [k, v] of urlMap) {
    if (k.includes("://")) continue;
    const bare = k.includes("/") ? k.split("/").pop() : k;
    if (!bare || bare.length < 3) continue;
    if (bareMap.has(bare) && bareMap.get(bare) !== v) {
      collisions.add(bare);
      continue;
    }
    if (!collisions.has(bare)) bareMap.set(bare, v);
  }
  for (const c of collisions) bareMap.delete(c);
  return bareMap;
}

/**
 * Resolve any URL-like string to localPath using map.
 * Handles different ?sign= query than collected URL.
 */
export function resolveToLocal(raw, urlMap, bareMap) {
  if (!raw || typeof raw !== "string") return null;
  const val = raw.trim();
  if (!val || /^(data:|blob:|javascript:|#|mailto:)/i.test(val)) return null;
  if (urlMap.has(val)) return urlMap.get(val);

  const clean = val.split("#")[0];
  if (urlMap.has(clean)) return urlMap.get(clean);

  const noQuery = clean.split("?")[0];
  if (urlMap.has(noQuery)) return urlMap.get(noQuery);

  try {
    const u = new URL(clean, "https://dummy.local");
    // absolute
    if (/^https?:/i.test(clean) || clean.startsWith("//")) {
      const abs = clean.startsWith("//") ? "https:" + clean : clean;
      const uu = new URL(abs);
      const candidates = [
        uu.href,
        uu.origin + uu.pathname,
        uu.pathname,
        uu.pathname.slice(1),
        uu.pathname.split("/").filter(Boolean).slice(-2).join("/"),
        uu.pathname.split("/").filter(Boolean).slice(-3).join("/"),
        uu.pathname.split("/").pop()
      ];
      for (const c of candidates) {
        if (c && urlMap.has(c)) return urlMap.get(c);
        if (c && bareMap.has(c)) return bareMap.get(c);
      }
    } else {
      // relative / absolute path
      if (urlMap.has(noQuery)) return urlMap.get(noQuery);
      if (urlMap.has(noQuery.replace(/^\//, ""))) return urlMap.get(noQuery.replace(/^\//, ""));
      const bare = noQuery.split("/").pop();
      if (bare && (urlMap.has(bare) || bareMap.has(bare))) {
        return urlMap.get(bare) || bareMap.get(bare);
      }
      const segs = noQuery.split("/").filter(Boolean);
      if (segs.length >= 2) {
        const tail = segs.slice(-2).join("/");
        if (urlMap.has(tail)) return urlMap.get(tail);
      }
    }
  } catch {}

  const bare = noQuery.split("/").pop();
  if (bare && bareMap.has(bare)) return bareMap.get(bare);
  if (bare && urlMap.has(bare)) return urlMap.get(bare);
  return null;
}

function stripSourceMaps(text) {
  let n = 0;
  let out = text.replace(/\/\/[#@]\s*sourceMappingURL\s*=\s*\S+/g, () => {
    n++;
    return "/* GC: sourceMappingURL stripped */";
  });
  out = out.replace(/\/\*#\s*sourceMappingURL\s*=\s*[^*]+\*\//g, () => {
    n++;
    return "/* GC: sourceMappingURL stripped */";
  });
  return { text: out, count: n };
}

/**
 * Replace http(s) URLs in free text when resolvable to local (includes ?sign= variants).
 */
function rewriteAbsoluteUrls(text, urlMap, bareMap) {
  let n = 0;
  // Match full URLs including query (signed CDN)
  const out = text.replace(
    /(?:https?:)?\/\/[a-z0-9.-]+(?::\d+)?\/[^\s"'<>)\\]*/gi,
    (match) => {
      // trim trailing punctuation often from CSS/HTML
      let url = match;
      let trail = "";
      while (/[.,;:)]$/.test(url)) {
        trail = url.slice(-1) + trail;
        url = url.slice(0, -1);
      }
      const local = resolveToLocal(url, urlMap, bareMap);
      if (local) {
        n++;
        return local + trail;
      }
      return match;
    }
  );
  return { text: out, count: n };
}

/**
 * Aggressive multi-pass rewrite — HTML/CSS/JS references → local paths
 */
export function rewriteContent(text, urlMap, isHtml, opts = {}) {
  let out = text;
  const passes = opts.passes || 3;
  const bareMap = buildBareMap(urlMap);
  let urlHits = 0;

  for (let pass = 0; pass < passes; pass++) {
    // 1. Absolute URLs with arbitrary query (signed) → local FIRST
    //    so ?sign=... is consumed as one unit (not left hanging on local path)
    const abs = rewriteAbsoluteUrls(out, urlMap, bareMap);
    out = abs.text;
    urlHits += abs.count;

    // 2. Longest exact keys — for http(s) keys also eat optional ?query
    const entries = [...urlMap.entries()]
      .filter(([k]) => k.length >= 4 && (k.includes("/") || k.startsWith("http") || k.startsWith("//")))
      .sort((a, b) => b[0].length - a[0].length);

    for (const [from, to] of entries) {
      if (!(from.startsWith("http") || from.startsWith("//"))) {
        if (out.includes(from)) out = out.split(from).join(to);
        continue;
      }
      // Replace every occurrence of `from` + optional ?query or #hash
      let idx = 0;
      let built = "";
      while (idx < out.length) {
        const at = out.indexOf(from, idx);
        if (at < 0) {
          built += out.slice(idx);
          break;
        }
        built += out.slice(idx, at) + to;
        let j = at + from.length;
        if (j < out.length && (out[j] === "?" || out[j] === "#")) {
          j++;
          while (j < out.length && !/[\s"'<>)]/.test(out[j])) j++;
        }
        idx = j;
      }
      out = built;
    }
    // 3. CSS url()
    out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, p) => {
      const raw = p.trim();
      if (/^(data:|blob:|#)/i.test(raw)) return m;
      const local = resolveToLocal(raw, urlMap, bareMap);
      if (local) return `url(${q || ""}${local}${q || ""})`;
      return m;
    });

    // 4. HTML attributes
    if (isHtml) {
      out = out.replace(
        /\b(src|href|data-src|data-href|poster|data-original|data-lazy|data-url)\s*=\s*(['"])([^'"]+)\2/gi,
        (m, attr, q, val) => {
          const local = resolveToLocal(val, urlMap, bareMap);
          if (local) return `${attr}=${q}${local}${q}`;
          return m;
        }
      );
      // srcset
      out = out.replace(/\bsrcset\s*=\s*(['"])([^'"]+)\1/gi, (m, q, val) => {
        const parts = val.split(",").map((part) => {
          const bits = part.trim().split(/\s+/);
          if (!bits[0]) return part;
          const local = resolveToLocal(bits[0], urlMap, bareMap);
          if (local) {
            bits[0] = local;
            return bits.join(" ");
          }
          return part.trim();
        });
        return `srcset=${q}${parts.join(", ")}${q}`;
      });
      // style="...url(...)..."
      out = out.replace(/\bstyle\s*=\s*(['"])([\s\S]*?)\1/gi, (m, q, style) => {
        const next = style.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (mm, qq, p) => {
          const local = resolveToLocal(p.trim(), urlMap, bareMap);
          if (local) return `url(${qq || ""}${local}${qq || ""})`;
          return mm;
        });
        return `style=${q}${next}${q}`;
      });
    }

    // 5. Bare quoted paths that look like CDN files
    out = out.replace(/(['"])(\/?[a-z0-9_.-]+\/[a-z0-9_./-]+\.(?:png|jpe?g|gif|webp|js|mjs|css|json|mp3|ogg|woff2?|wasm))\1/gi, (m, q, path) => {
      const local = resolveToLocal(path, urlMap, bareMap);
      if (local) return q + local + q;
      return m;
    });
  }

  return { text: out, urlHits };
}

/**
 * Package-wide smart rewrite
 */
export function smartPackage(zipFiles, manifest) {
  const urlMap = buildUrlToLocalMap(manifest);
  const bareMap = buildBareMap(urlMap);
  const result = {
    rewritten: 0,
    neutralized: 0,
    sourceMapsStripped: 0,
    urlHits: 0,
    mapSize: urlMap.size
  };

  // Prefer writing a clean root index.html from best HTML entry if root still external-heavy
  const htmlKeys = Object.keys(zipFiles).filter((k) => /\.html?$/i.test(k) || k === "index.html");

  for (const key of Object.keys(zipFiles)) {
    const isHtml = /\.html?$/i.test(key) || key === "index.html";
    const isJs = /\.(js|mjs)$/i.test(key);
    const isCss = /\.css$/i.test(key);
    const isJson = /\.json$/i.test(key);
    if (!isHtml && !isJs && !isCss && !isJson) continue;
    try {
      let text = new TextDecoder().decode(zipFiles[key]);
      const before = text;

      if (!isJson) {
        const rw = rewriteContent(text, urlMap, isHtml, { passes: 3 });
        text = rw.text;
        result.urlHits += rw.urlHits || 0;
      }

      if (isJs || isHtml) {
        text = text.replace(/\b(import|from|require)\s*\(?\s*['"]([^'"]+)['"]/g, (m, kw, p) => {
          const local = resolveToLocal(p, urlMap, bareMap);
          if (local) return m.replace(p, local);
          return m;
        });
        text = text.replace(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (m, p) => {
          const local = resolveToLocal(p, urlMap, bareMap);
          if (local) return `import('${local}')`;
          return m;
        });
      }

      if (isJson) {
        try {
          let j = JSON.parse(text);
          let touched = false;
          const walk = (obj) => {
            if (typeof obj === "string") {
              const local = resolveToLocal(obj, urlMap, bareMap);
              if (local) {
                touched = true;
                return local;
              }
              return obj;
            }
            if (Array.isArray(obj)) return obj.map(walk);
            if (obj && typeof obj === "object") {
              for (const k of Object.keys(obj)) obj[k] = walk(obj[k]);
            }
            return obj;
          };
          j = walk(j);
          if (touched) text = JSON.stringify(j);
        } catch {}
      }

      if (isJs || isHtml) {
        const res = neutralizeFrameBusters(text);
        text = res.text;
        result.neutralized += res.count;
        const sm = stripSourceMaps(text);
        text = sm.text;
        result.sourceMapsStripped += sm.count;
      }

      if (text !== before) {
        zipFiles[key] = strToU8(text);
        result.rewritten++;
      }
    } catch {}
  }

  // Ensure root index.html is the best rewritten HTML (copy from assets/html if root still has many https CDN asset URLs)
  try {
    if (zipFiles["index.html"]) {
      let root = new TextDecoder().decode(zipFiles["index.html"]);
      const httpsRoot = (root.match(/https?:\/\/static\.|https?:\/\/public\./gi) || []).length;
      if (httpsRoot > 3) {
        // try assets/html/*index*
        const alt = Object.keys(zipFiles).find(
          (k) => /assets\/html\/.*index.*\.html?$/i.test(k) || /assets\/html\/0001/i.test(k)
        );
        if (alt) {
          let altText = new TextDecoder().decode(zipFiles[alt]);
          const rw = rewriteContent(altText, urlMap, true, { passes: 3 });
          altText = rw.text;
          const httpsAlt = (altText.match(/https?:\/\/static\.|https?:\/\/public\./gi) || []).length;
          if (httpsAlt < httpsRoot) {
            zipFiles["index.html"] = strToU8(altText);
            result.rewritten++;
            result.indexPromotedFrom = alt;
          } else {
            // re-rewrite root harder
            const again = rewriteContent(root, urlMap, true, { passes: 4 });
            if (again.text !== root) {
              zipFiles["index.html"] = strToU8(again.text);
              result.rewritten++;
              result.urlHits += again.urlHits || 0;
            }
          }
        }
      }
    }
  } catch {}

  return result;
}
