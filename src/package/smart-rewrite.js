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

export function buildUrlToLocalMap(manifest) {
  const map = new Map();
  for (const r of manifest || []) {
    if (r.url && r.localPath) {
      map.set(r.url, r.localPath);
      try {
        const u = new URL(r.url);
        map.set(u.href, r.localPath);
        map.set("//" + u.host + u.pathname + u.search, r.localPath);
        map.set(u.pathname + u.search, r.localPath);
        map.set(u.pathname, r.localPath);
        const bare = u.pathname.split("/").pop();
        if (bare) {
          map.set(bare, r.localPath);
          map.set(bare + u.search, r.localPath);
        }
        if (u.search) map.set(u.origin + u.pathname, r.localPath);
        // decodeURI variant
        try {
          const dec = decodeURIComponent(u.pathname);
          if (dec !== u.pathname) map.set(dec, r.localPath);
        } catch {}
      } catch {}
    }
  }
  return map;
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
 * Aggressive multi-pass rewrite
 */
export function rewriteContent(text, urlMap, isHtml, opts = {}) {
  let out = text;
  const passes = opts.passes || 2;

  for (let pass = 0; pass < passes; pass++) {
    // 1. Full absolute + protocol-relative (longest first)
    const entries = [...urlMap.entries()]
      .filter(([k]) => k.includes("/") || k.startsWith("http") || k.startsWith("//"))
      .sort((a, b) => b[0].length - a[0].length);

    for (const [from, to] of entries) {
      if (from.length < 4) continue;
      if (out.includes(from)) out = out.split(from).join(to);
    }

    // 2. Bare names
    const bareMap = new Map();
    for (const [k, v] of urlMap) {
      if (!k.includes("/") && k.length > 3) bareMap.set(k, v);
    }

    // 3. CSS url() including nested / data-uri skip
    out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, p) => {
      const raw = p.trim();
      if (/^(data:|blob:|#)/i.test(raw)) return m;
      const clean = raw.split("?")[0].split("#")[0];
      if (urlMap.has(raw)) return `url(${q || ""}${urlMap.get(raw)}${q || ""})`;
      if (urlMap.has(clean)) return `url(${q || ""}${urlMap.get(clean)}${q || ""})`;
      const name = clean.split("/").pop();
      if (name && (urlMap.has(name) || bareMap.has(name))) {
        return `url(${q || ""}${urlMap.get(name) || bareMap.get(name)}${q || ""})`;
      }
      // tail-2
      const segs = clean.split("/").filter(Boolean);
      if (segs.length >= 2) {
        const tail = segs.slice(-2).join("/");
        for (const [k, v] of urlMap) {
          if (String(k).endsWith(tail) || String(v).endsWith(tail)) {
            return `url(${q || ""}${v}${q || ""})`;
          }
        }
      }
      return m;
    });

    // 4. HTML attributes
    if (isHtml) {
      out = out.replace(
        /\b(src|href|data-src|data-href|poster)\s*=\s*(['"])([^'"]+)\2/gi,
        (m, attr, q, val) => {
          if (/^(data:|blob:|javascript:|#|mailto:)/i.test(val)) return m;
          if (urlMap.has(val)) return `${attr}=${q}${urlMap.get(val)}${q}`;
          const clean = val.split("?")[0];
          if (urlMap.has(clean)) return `${attr}=${q}${urlMap.get(clean)}${q}`;
          const name = clean.split("/").pop();
          if (name && (urlMap.has(name) || bareMap.has(name))) {
            return `${attr}=${q}${urlMap.get(name) || bareMap.get(name)}${q}`;
          }
          return m;
        }
      );
      // srcset
      out = out.replace(/\bsrcset\s*=\s*(['"])([^'"]+)\1/gi, (m, q, val) => {
        const parts = val.split(",").map((part) => {
          const bits = part.trim().split(/\s+/);
          const u = bits[0];
          if (urlMap.has(u)) bits[0] = urlMap.get(u);
          else {
            const name = u.split("?")[0].split("/").pop();
            if (name && (urlMap.has(name) || bareMap.has(name))) bits[0] = urlMap.get(name) || bareMap.get(name);
          }
          return bits.join(" ");
        });
        return `srcset=${q}${parts.join(", ")}${q}`;
      });
    }

    // 5. Escaped JSON-ish URLs in JS strings https:\/\/
    out = out.replace(/https?:\\\/\\\/[^"'\\]+/g, (m) => {
      const unesc = m.replace(/\\\//g, "/");
      if (urlMap.has(unesc)) return String(urlMap.get(unesc)).replace(/\//g, "\\/");
      try {
        const u = new URL(unesc);
        const bare = u.pathname.split("/").pop();
        if (bare && (urlMap.has(bare) || bareMap.has(bare))) {
          return String(urlMap.get(bare) || bareMap.get(bare)).replace(/\//g, "\\/");
        }
      } catch {}
      return m;
    });
  }

  // Strip source maps (always once)
  const sm = stripSourceMaps(out);
  out = sm.text;

  return out;
}

export function smartPackage(zipFiles, manifest) {
  const urlMap = buildUrlToLocalMap(manifest);
  const result = {
    rewritten: 0,
    neutralized: 0,
    sourceMapsStripped: 0,
    passes: 2
  };

  // Also index bare from actual zip keys
  for (const key of Object.keys(zipFiles || {})) {
    const bare = key.split("/").pop();
    if (bare && bare.length > 3 && !urlMap.has(bare)) urlMap.set(bare, key);
  }

  const bareMap = new Map();
  for (const [k, v] of urlMap) {
    if (!String(k).includes("/") && String(k).length > 3) bareMap.set(k, v);
  }

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
        text = rewriteContent(text, urlMap, isHtml, { passes: 2 });
      }
      if (isJs || isHtml) {
        text = text.replace(/\b(import|from|require)\s*\(?\s*['"]([^'"]+)['"]/g, (m, kw, p) => {
          if (urlMap.has(p)) return m.replace(p, urlMap.get(p));
          const bare = p.split("/").pop();
          if (bare && bareMap.has(bare)) return m.replace(p, bareMap.get(bare));
          return m;
        });
        text = text.replace(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (m, p) => {
          if (urlMap.has(p)) return `import('${urlMap.get(p)}')`;
          const bare = p.split("/").pop();
          if (bare && bareMap.has(bare)) return `import('${bareMap.get(bare)}')`;
          return m;
        });
      }
      if (isJson) {
        try {
          let j = JSON.parse(text);
          let touched = false;
          const walk = (obj) => {
            if (typeof obj === "string") {
              if (urlMap.has(obj)) {
                touched = true;
                return urlMap.get(obj);
              }
              try {
                const u = new URL(obj);
                const bare = u.pathname.split("/").pop();
                if (bare && bareMap.has(bare)) {
                  touched = true;
                  return bareMap.get(bare);
                }
              } catch {}
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
  return result;
}
