/**
 * Dependency Analyzer + Path Resolver
 * Scan HTML/JS/CSS/JSON → graph referensi → resolve ke path lokal di ZIP.
 */

const ASSET_EXT =
  /\.(js|mjs|cjs|css|json|png|jpe?g|gif|webp|svg|avif|ico|woff2?|ttf|otf|mp3|ogg|wav|m4a|mp4|webm|wasm|data|atlas|skel|fnt|xml|txt|bin|bundle|unityweb)(\?|#|$)/i;

const SKIP_SCHEME = /^(data:|blob:|javascript:|mailto:|tel:|#)/i;

function safeDecode(u8) {
  try {
    return new TextDecoder().decode(u8);
  } catch {
    return "";
  }
}

function bareName(path) {
  const p = String(path || "").split("?")[0].split("#")[0];
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "";
}

function normalizeRef(ref) {
  if (!ref) return "";
  let s = String(ref).trim().replace(/\\/g, "/");
  if (SKIP_SCHEME.test(s)) return "";
  // strip quotes leftovers
  s = s.replace(/^['"]|['"]$/g, "");
  return s;
}

/**
 * Build indexes from zip paths
 */
export function buildPathIndex(zipFiles) {
  const byPath = new Map();
  const byBare = new Map();
  const all = Object.keys(zipFiles || {});
  for (const p of all) {
    const norm = p.replace(/^\.\//, "");
    byPath.set(norm, norm);
    byPath.set("/" + norm, norm);
    byPath.set("./" + norm, norm);
    const b = bareName(norm);
    if (b) {
      if (!byBare.has(b)) byBare.set(b, []);
      byBare.get(b).push(norm);
      const low = b.toLowerCase();
      if (!byBare.has(low)) byBare.set(low, []);
      if (!byBare.get(low).includes(norm)) byBare.get(low).push(norm);
    }
  }
  return { byPath, byBare, all };
}

/**
 * Resolve a reference against zip index + optional base file path
 */
export function resolvePath(ref, index, baseFile = "") {
  const raw = normalizeRef(ref);
  if (!raw) return { ok: false, reason: "empty-or-skip", ref };
  if (SKIP_SCHEME.test(raw)) return { ok: false, reason: "scheme-skip", ref: raw };

  // Absolute URL → try pathname + bare
  if (/^https?:\/\//i.test(raw) || raw.startsWith("//")) {
    try {
      const abs = raw.startsWith("//") ? "https:" + raw : raw;
      const u = new URL(abs);
      const path = u.pathname.replace(/^\//, "");
      if (index.byPath.has(path)) return { ok: true, local: index.byPath.get(path), ref: raw, via: "url-pathname" };
      if (index.byPath.has(u.pathname)) return { ok: true, local: index.byPath.get(u.pathname), ref: raw, via: "url-pathname2" };
      const b = bareName(u.pathname);
      if (b && index.byBare.has(b)) {
        return { ok: true, local: index.byBare.get(b)[0], ref: raw, via: "url-bare", ambiguous: index.byBare.get(b).length > 1 };
      }
      return { ok: false, reason: "external-unresolved", ref: raw, host: u.host };
    } catch {
      return { ok: false, reason: "bad-url", ref: raw };
    }
  }

  // Relative / root path
  let candidate = raw.replace(/^\.\//, "");
  if (index.byPath.has(candidate)) return { ok: true, local: index.byPath.get(candidate), ref: raw, via: "exact" };
  if (index.byPath.has(raw)) return { ok: true, local: index.byPath.get(raw), ref: raw, via: "exact-raw" };

  // Resolve relative to base file directory
  if (baseFile) {
    const baseDir = baseFile.includes("/") ? baseFile.replace(/\/[^/]+$/, "/") : "";
    const joined = (baseDir + candidate).replace(/\/+/g, "/");
    // normalize .. segments lightly
    const parts = [];
    for (const seg of joined.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg && seg !== ".") parts.push(seg);
    }
    const norm = parts.join("/");
    if (index.byPath.has(norm)) return { ok: true, local: index.byPath.get(norm), ref: raw, via: "relative-base" };
  }

  // Tail match (last 2 segments)
  const segs = candidate.split("/").filter(Boolean);
  if (segs.length >= 2) {
    const tail = segs.slice(-2).join("/");
    const hit = index.all.find((p) => p.endsWith("/" + tail) || p.endsWith(tail));
    if (hit) return { ok: true, local: hit, ref: raw, via: "tail-2" };
  }

  // Bare filename
  const b = bareName(candidate);
  if (b && index.byBare.has(b)) {
    return { ok: true, local: index.byBare.get(b)[0], ref: raw, via: "bare", ambiguous: index.byBare.get(b).length > 1 };
  }
  if (b && index.byBare.has(b.toLowerCase())) {
    return { ok: true, local: index.byBare.get(b.toLowerCase())[0], ref: raw, via: "bare-ci" };
  }

  return { ok: false, reason: "missing", ref: raw, bare: b || null };
}

/**
 * Extract references from text content
 */
export function extractRefs(text, filePath = "") {
  const refs = [];
  if (!text || text.length > 2_000_000) return refs;
  const isCss = /\.css$/i.test(filePath);
  const isHtml = /\.html?$/i.test(filePath) || filePath === "index.html";
  const isJs = /\.(js|mjs|cjs)$/i.test(filePath);
  const isJson = /\.json$/i.test(filePath);

  const push = (ref, kind) => {
    const n = normalizeRef(ref);
    if (!n) return;
    // keep likely assets or paths with extension / relative
    if (ASSET_EXT.test(n) || n.startsWith("./") || n.startsWith("../") || n.startsWith("/") || /^https?:/i.test(n) || n.startsWith("//")) {
      refs.push({ ref: n, kind, from: filePath });
    } else if (/\.[a-z0-9]{1,8}$/i.test(n.split("?")[0])) {
      refs.push({ ref: n, kind, from: filePath });
    }
  };

  // HTML attrs
  if (isHtml || isJs) {
    let m;
    const reAttr = /\b(?:src|href|data-src|data-href|poster|srcset)\s*=\s*["']([^"']+)["']/gi;
    while ((m = reAttr.exec(text))) {
      if (m[0].toLowerCase().includes("srcset")) {
        m[1].split(",").forEach((part) => {
          const url = part.trim().split(/\s+/)[0];
          push(url, "srcset");
        });
      } else push(m[1], "attr");
    }
  }

  // CSS url()
  if (isCss || isHtml || isJs) {
    let m;
    const reUrl = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
    while ((m = reUrl.exec(text))) push(m[1], "css-url");
  }

  // JS import / require / from
  if (isJs || isHtml) {
    let m;
    const patterns = [
      [/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, "import()"],
      [/\bfrom\s+['"]([^'"]+)['"]/g, "from"],
      [/import\s+['"]([^'"]+)['"]/g, "import"],
      [/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, "require"],
      [/\b(?:load|preload|fetch)\s*\(\s*['"]([^'"]+)['"]/gi, "load-call"]
    ];
    for (const [re, kind] of patterns) {
      re.lastIndex = 0;
      while ((m = re.exec(text))) push(m[1], kind);
    }
    // string literals that look like asset paths (limit)
    const reStr = /["']([^"']+\.(?:js|mjs|css|json|png|jpe?g|gif|webp|svg|woff2?|mp3|ogg|wav|wasm|atlas|skel|data))["']/gi;
    let count = 0;
    while ((m = reStr.exec(text)) && count < 200) {
      push(m[1], "string-literal");
      count++;
    }
  }

  // JSON string values that look like paths
  if (isJson) {
    let m;
    const reStr = /"([^"]+\.(?:js|mjs|css|json|png|jpe?g|gif|webp|svg|woff2?|mp3|ogg|wav|wasm|atlas|skel|data|xml))"/gi;
    let count = 0;
    while ((m = reStr.exec(text)) && count < 300) {
      push(m[1], "json-string");
      count++;
    }
  }

  return refs;
}

/**
 * Full analysis
 */
export function analyzeDependencies(zipFiles, manifest = []) {
  const index = buildPathIndex(zipFiles);
  const edges = []; // { from, ref, kind, resolved, local, reason }
  const scannedFiles = [];
  const byFrom = {};

  const textExt = /\.(html?|js|mjs|cjs|css|json)$/i;
  for (const [path, data] of Object.entries(zipFiles || {})) {
    if (!data) continue;
    if (!textExt.test(path) && path !== "index.html") continue;
    if (data.byteLength > 1_500_000) continue;
    const text = safeDecode(data);
    if (!text) continue;
    scannedFiles.push(path);
    const refs = extractRefs(text, path);
    for (const r of refs) {
      const resolved = resolvePath(r.ref, index, path);
      const edge = {
        from: path,
        ref: r.ref,
        kind: r.kind,
        ok: resolved.ok,
        local: resolved.local || null,
        reason: resolved.reason || null,
        via: resolved.via || null
      };
      edges.push(edge);
      if (!byFrom[path]) byFrom[path] = { ok: 0, missing: 0, external: 0 };
      if (resolved.ok) byFrom[path].ok++;
      else if (resolved.reason === "external-unresolved") byFrom[path].external++;
      else byFrom[path].missing++;
    }
  }

  // Also check manifest URLs not present as local files
  const manifestMissing = [];
  for (const r of manifest || []) {
    if (!r.url || !r.localPath) continue;
    if (zipFiles[r.localPath]) continue;
    // localPath claimed but missing body
    manifestMissing.push({ url: r.url, localPath: r.localPath });
  }

  const missing = edges.filter((e) => !e.ok && e.reason === "missing");
  const external = edges.filter((e) => !e.ok && e.reason === "external-unresolved");
  const resolved = edges.filter((e) => e.ok);

  // Unique missing bare names
  const missingUnique = [];
  const seenMiss = new Set();
  for (const e of missing) {
    const key = bareName(e.ref) || e.ref;
    if (seenMiss.has(key)) continue;
    seenMiss.add(key);
    missingUnique.push({ ref: e.ref, from: e.from, kind: e.kind, bare: key });
  }

  const totalEdges = edges.length || 1;
  const score = Math.round((resolved.length / totalEdges) * 100);

  return {
    scannedFiles: scannedFiles.length,
    totalRefs: edges.length,
    resolved: resolved.length,
    missing: missing.length,
    external: external.length,
    score,
    missingUnique: missingUnique.slice(0, 80),
    externalSample: external.slice(0, 30).map((e) => ({ ref: e.ref, from: e.from })),
    topMissingFiles: Object.entries(byFrom)
      .filter(([, v]) => v.missing > 0)
      .sort((a, b) => b[1].missing - a[1].missing)
      .slice(0, 20)
      .map(([file, v]) => ({ file, ...v })),
    manifestOrphans: manifestMissing.slice(0, 20),
    // compact edge sample for debugging
    edgeSample: edges.slice(0, 40),
    note: "Dependency graph heuristik dari string/path di HTML/JS/CSS/JSON."
  };
}
