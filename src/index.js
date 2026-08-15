import { launch } from "@cloudflare/playwright";
import { zipSync, strToU8 } from "fflate";

const TYPES = new Set(["document","script","stylesheet","image","media","font","xhr","fetch"]);

const EXCLUDE = [
  /google-analytics\.com/i,/googletagmanager\.com/i,/facebook\.net/i,
  /doubleclick\.net/i,/googlesyndication\.com/i,/hotjar\.com/i,
  /clarity\.ms/i,/segment\.(com|io)/i,/mixpanel\.com/i,/sentry\.io/i,
  /newrelic\.com/i,/fullstory\.com/i
];

function safe(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

/**
 * Klasifikasi sub-folder khusus slot / game asset (Poin 1).
 * Mengembalikan nama subfolder di bawah assets/ berdasarkan
 * path, nama file, ekstensi, dan tipe resource.
 */
function classifySlotSubfolder(url, type, contentType = "") {
  const u = String(url || "").toLowerCase();
  let pathname = "";
  let filename = "";
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname.toLowerCase();
    filename = (pathname.split("/").pop() || "").split("?")[0];
  } catch {
    filename = u.split("/").pop() || "";
  }
  const ct = (contentType || "").toLowerCase();

  // --- Config / data definitions ---
  if (
    /paytable|pay[_-]?table|payout/i.test(u) ||
    /paytable|pay[_-]?table/.test(filename)
  ) {
    return { sub: "config/paytable", reason: "paytable" };
  }
  if (
    /\/(config|configs|settings|data)\//i.test(pathname) &&
    (/\.json($|\?)/i.test(pathname) || ct.includes("json"))
  ) {
    if (/symbol/i.test(u)) return { sub: "config/symbols", reason: "symbol-config" };
    if (/feature|bonus|freespin|free[_-]?spin|scatter|wild/i.test(u)) {
      return { sub: "config/features", reason: "feature-config" };
    }
    return { sub: "config", reason: "config-json" };
  }
  if (/\.(json|xml)($|\?)/i.test(pathname) && /symbol|reel|pay|feature|bet|line|ways/i.test(filename)) {
    if (/symbol/i.test(filename)) return { sub: "config/symbols", reason: "symbol-json" };
    if (/pay/i.test(filename)) return { sub: "config/paytable", reason: "pay-json" };
    if (/feature|bonus|free/i.test(filename)) return { sub: "config/features", reason: "feature-json" };
    return { sub: "config", reason: "game-data-json" };
  }

  // --- Atlas / Spine / skeletal ---
  if (/\.(atlas|skel|spine)($|\?)/i.test(pathname) || /spine|skeleton|skeletal/i.test(u)) {
    return { sub: "atlases", reason: "spine-atlas" };
  }
  if (/atlas|spritesheet|sprite[_-]?sheet|textureatlas|texture[_-]?atlas/i.test(u)) {
    return { sub: "atlases", reason: "spritesheet-atlas" };
  }

  // --- Symbols ---
  if (
    /\/symbols?\//i.test(pathname) ||
    /\b(symbol|symbols|symb)[_-]?\d*/i.test(filename) ||
    /\b(wild|scatter|bonus|jackpot|mystery)[_-]?(symbol|sym|icon)?/i.test(filename) ||
    /\b(high|low|mid)[_-]?(symbol|sym|icon)/i.test(filename)
  ) {
    return { sub: "symbols", reason: "symbol-path-or-name" };
  }

  // --- Reels ---
  if (
    /\/reels?\//i.test(pathname) ||
    /\b(reel|reels|strip|reelstrip|reel[_-]?strip)[_-]?\d*/i.test(filename) ||
    /\breel[_-]?(bg|background|frame|mask)/i.test(filename)
  ) {
    return { sub: "reels", reason: "reel-path-or-name" };
  }

  // --- Backgrounds ---
  if (
    /\/(bg|backgrounds?|backdrops?)\//i.test(pathname) ||
    /\b(bg|background|backdrop|scene[_-]?bg)[_-]?\w*/i.test(filename)
  ) {
    return { sub: "backgrounds", reason: "background" };
  }

  // --- UI ---
  if (
    /\/(ui|hud|interface|buttons?|controls?)\//i.test(pathname) ||
    /\b(btn|button|ui|hud|panel|popup|modal|spinner|loader|progress|meter|bar)[_-]?\w*/i.test(filename) ||
    /\b(spin[_-]?btn|auto[_-]?spin|max[_-]?bet|paytable[_-]?btn)/i.test(filename)
  ) {
    return { sub: "ui", reason: "ui-element" };
  }

  // --- Particles / effects ---
  if (
    /\/(particles?|effects?|fx|vfx)\//i.test(pathname) ||
    /\b(particle|emitter|spark|glow|flash|burst|fx|vfx)[_-]?\w*/i.test(filename)
  ) {
    return { sub: "particles", reason: "particle-fx" };
  }

  // --- Animations ---
  if (
    /\/(anims?|animations?|anim)\//i.test(pathname) ||
    /\b(anim|animation|win[_-]?anim|land(ing)?|transition|intro|outro)[_-]?\w*/i.test(filename) ||
    /\.(mp4|webm)($|\?)/i.test(pathname)
  ) {
    return { sub: "animations", reason: "animation" };
  }

  // --- Audio (lebih spesifik) ---
  if (type === "media" || /\.(mp3|ogg|wav|m4a|aac)($|\?)/i.test(pathname) || ct.startsWith("audio/")) {
    if (/\b(bgm|music|theme|ambient|loop)[_-]?\w*/i.test(filename)) {
      return { sub: "audio/bgm", reason: "bgm" };
    }
    if (/\b(spin|reel[_-]?stop|stop|click|ui[_-]?click|button)[_-]?\w*/i.test(filename)) {
      return { sub: "audio/sfx", reason: "sfx-ui-or-spin" };
    }
    if (/\b(win|big[_-]?win|mega|bonus|free[_-]?spin|scatter|feature)[_-]?\w*/i.test(filename)) {
      return { sub: "audio/win", reason: "win-or-feature" };
    }
    return { sub: "audio", reason: "audio-general" };
  }

  // --- Fonts ---
  if (type === "font" || /\.(woff2?|ttf|otf|eot)($|\?)/i.test(pathname) || ct.includes("font")) {
    return { sub: "fonts", reason: "font" };
  }

  // --- Scripts ---
  if (type === "script" || /\.(js|mjs)($|\?)/i.test(pathname)) {
    if (/engine|phaser|pixi|unity|main|bundle|app|game/i.test(filename)) {
      return { sub: "js/engine", reason: "engine-or-main" };
    }
    if (/reel|symbol|paytable|feature|bonus|spin|slot/i.test(filename)) {
      return { sub: "js/logic", reason: "game-logic" };
    }
    return { sub: "js", reason: "script" };
  }

  // --- Styles ---
  if (type === "stylesheet" || /\.css($|\?)/i.test(pathname)) {
    return { sub: "css", reason: "stylesheet" };
  }

  // --- HTML ---
  if (type === "document" || /\.html?($|\?)/i.test(pathname)) {
    return { sub: "html", reason: "document" };
  }

  // --- Images fallback ---
  if (type === "image" || /\.(png|jpe?g|gif|webp|svg|ico)($|\?)/i.test(pathname)) {
    return { sub: "images", reason: "image-general" };
  }

  // --- Data / XHR body yang dianggap game data ---
  if (type === "xhr" || type === "fetch") {
    return { sub: "data", reason: "data-xhr" };
  }

  return { sub: "other", reason: "unclassified" };
}

/**
 * Tentukan folder ZIP final.
 * category: game | api | server
 * sub: hasil classifySlotSubfolder (hanya dipakai untuk game)
 */
function folderOf(type, category, sub = null) {
  if (category === "api" || category === "server") {
    return ({
      document: "server/html",
      script: "server/js",
      stylesheet: "server/css",
      image: "server/images",
      media: "server/media",
      font: "server/fonts",
      xhr: "server/api",
      fetch: "server/api"
    })[type] || "server/other";
  }

  // Game assets — pakai sub-folder slot jika ada
  if (sub && typeof sub === "string" && sub.length > 0) {
    return "assets/" + sub;
  }

  // Fallback lama (kompatibel)
  return ({
    document: "assets/html",
    script: "assets/js",
    stylesheet: "assets/css",
    image: "assets/images",
    media: "assets/audio",
    font: "assets/fonts",
    xhr: "assets/data",
    fetch: "assets/data"
  })[type] || "assets/other";
}

function isExcluded(url) {
  return EXCLUDE.some(r => r.test(url));
}

/** Klasifikasi: game asset vs API/server */
function classifyResource(url, type, contentType, bodyText) {
  const ct = (contentType || "").toLowerCase();
  const u = String(url || "").toLowerCase();
  let pathname = "";
  let host = "";
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname.toLowerCase();
    host = parsed.hostname.toLowerCase();
  } catch {}

  // Static game assets
  if (["image", "media", "font", "stylesheet"].includes(type)) {
    return { category: "game", reason: "static-asset:" + type };
  }
  if (/\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm|wasm)(\?|$)/i.test(pathname)) {
    return { category: "game", reason: "static-extension" };
  }

  // API / server signals
  const apiPathHints = [
    "/api/", "/v1/", "/v2/", "/v3/", "/graphql", "/rest/", "/rpc/",
    "/auth/", "/login", "/oauth", "/token", "/session",
    "/user/", "/users/", "/player/", "/profile",
    "/leaderboard", "/score", "/save", "/load", "/inventory",
    "/match", "/room", "/multiplayer", "/socket",
    "/config.json", "/settings", "/gateway"
  ];
  if (apiPathHints.some(h => pathname.includes(h) || u.includes(h))) {
    return { category: "api", reason: "path-hint" };
  }
  if (type === "xhr" || type === "fetch") {
    if (ct.includes("json") || ct.includes("text/plain") || ct.includes("xml") || ct.includes("javascript")) {
      // JSON dari fetch sering API; JS bundle besar = game
      if (ct.includes("json") || ct.includes("xml")) {
        return { category: "api", reason: "xhr-json" };
      }
      // body peek
      const sample = (bodyText || "").slice(0, 200).trim();
      if (sample.startsWith("{") || sample.startsWith("[")) {
        return { category: "api", reason: "body-json" };
      }
    }
    return { category: "api", reason: "xhr-fetch" };
  }

  // Script: large app bundles = game; small config-like = maybe server
  if (type === "script") {
    if (/config|settings|env|endpoint|api[-_]?url/i.test(pathname)) {
      return { category: "server", reason: "script-config" };
    }
    return { category: "game", reason: "script-bundle" };
  }

  if (type === "document") {
    return { category: "game", reason: "document" };
  }

  // Host berbeda dari page sering CDN asset (game) atau API subdomain
  if (host.startsWith("api.") || host.startsWith("api-") || host.split(".")[0] === "api") {
    return { category: "api", reason: "api-host" };
  }

  return { category: "game", reason: "default" };
}

function buildKeterangan(target, manifest, smart, analysis = null) {
  const game = manifest.filter(r => r.category === "game");
  const api = manifest.filter(r => r.category === "api");
  const server = manifest.filter(r => r.category === "server");

  // Hitung sub-kategori slot (Poin 1)
  const subCounts = {};
  for (const r of game) {
    const sub = r.subCategory || "other";
    subCounts[sub] = (subCounts[sub] || 0) + 1;
  }
  const subSorted = Object.entries(subCounts).sort((a, b) => b[1] - a[1]);

  const hosts = new Map();
  for (const r of manifest) {
    try {
      const h = new URL(r.url).hostname;
      if (!hosts.has(h)) hosts.set(h, { count: 0, categories: new Set(), samples: [] });
      const info = hosts.get(h);
      info.count++;
      info.categories.add(r.category || "game");
      if (info.samples.length < 5) info.samples.push(r.url);
    } catch {}
  }

  const apiEndpoints = api.slice(0, 80).map(r => ({
    url: r.url,
    method_hint: r.type,
    status: r.status,
    localPath: r.localPath,
    size: r.size,
    reason: r.classifyReason || ""
  }));

  const lines = [];
  lines.push("# KETERANGAN PAKET — Game Collector Pro");
  lines.push("");
  lines.push(`**Target:** ${target}`);
  lines.push(`**Dikumpulkan:** ${new Date().toISOString()}`);
  lines.push(`**Total resource:** ${manifest.length}`);
  lines.push(`**Smart rewrite:** ${smart?.rewritten || 0} file · frame-buster: ${smart?.neutralized || 0}`);
  lines.push("");
  lines.push("## Pemisahan otomatis");
  lines.push("");
  lines.push("| Kategori | Jumlah | Folder di ZIP |");
  lines.push("|----------|--------|---------------|");
  lines.push(`| Game (asset client) | ${game.length} | \`assets/\` |`);
  lines.push(`| API (response XHR/fetch) | ${api.length} | \`server/api/\` |`);
  lines.push(`| Server / config | ${server.length} | \`server/\` |`);
  lines.push("");
  lines.push("## Sub-klasifikasi asset slot (Poin 1)");
  lines.push("");
  if (subSorted.length) {
    lines.push("| Sub-folder | Jumlah |");
    lines.push("|------------|--------|");
    for (const [sub, n] of subSorted) {
      lines.push(`| \`assets/${sub}/\` | ${n} |`);
    }
  } else {
    lines.push("_Tidak ada sub-klasifikasi (belum ada asset game)._");
  }
  lines.push("");

  // Poin 2 — ringkasan analisis isi file
  lines.push("## Analisis isi file (Poin 2)");
  lines.push("");
  if (analysis && analysis.summary && !analysis.error) {
    const s = analysis.summary;
    lines.push("| Temuan | Jumlah |");
    lines.push("|--------|--------|");
    lines.push(`| JSON ter-parse | ${s.jsonParsed ?? 0} |`);
    lines.push(`| Paytable hits | ${s.paytableHits ?? 0} |`);
    lines.push(`| Symbol terdeteksi | ${s.symbolCount ?? 0} |`);
    lines.push(`| Feature hits | ${s.featureHits ?? 0} |`);
    lines.push(`| Bet / lines config | ${s.betConfigs ?? 0} |`);
    lines.push(`| Atlas / spritesheet | ${s.atlasCount ?? 0} |`);
    lines.push(`| Spine / skel | ${s.spineCount ?? 0} |`);
    lines.push(`| Audio sprite map | ${s.audioMapCount ?? 0} |`);
    lines.push(`| API snapshot | ${s.apiSnapshotCount ?? 0} |`);
    lines.push("");
    if (analysis.symbols && analysis.symbols.length) {
      lines.push("**Contoh symbol:** " + analysis.symbols.slice(0, 30).join(", "));
      lines.push("");
    }
    if (analysis.features && analysis.features.length) {
      lines.push("**Feature keys:** " + analysis.features.map(f => f.key).slice(0, 20).join(", "));
      lines.push("");
    }
    lines.push("Detail lengkap ada di `analisis.json`.");
  } else if (analysis && analysis.error) {
    lines.push("_Analisis gagal: " + analysis.error + "_");
  } else {
    lines.push("_Analisis tidak dijalankan._");
  }
  lines.push("");

  lines.push("## Host / server yang terdeteksi");
  lines.push("");
  for (const [host, info] of [...hosts.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const cats = [...info.categories].join(", ");
    lines.push(`### \`${host}\``);
    lines.push(`- Request: **${info.count}**`);
    lines.push(`- Kategori: ${cats}`);
    lines.push(`- Contoh URL:`);
    for (const s of info.samples) lines.push(`  - ${s}`);
    lines.push("");
  }
  lines.push("## Endpoint API (snapshot saat collect)");
  lines.push("");
  if (!apiEndpoints.length) {
    lines.push("_Tidak ada response API yang tertangkap saat collect._");
  } else {
    lines.push("File body disimpan di `server/api/`. Ini **snapshot** saat capture, bukan live server.");
    lines.push("");
    for (const ep of apiEndpoints) {
      lines.push(`- \`${ep.url}\``);
      lines.push(`  - local: \`${ep.localPath}\` · status ${ep.status} · ${ep.size} byte · ${ep.reason}`);
    }
  }
  lines.push("");
  lines.push("## Struktur ZIP");
  lines.push("");
  lines.push("```");
  lines.push("index.html");
  lines.push("assets/");
  lines.push("  symbols/          # Symbol / icon slot");
  lines.push("  reels/            # Reel graphics");
  lines.push("  ui/               # Tombol, panel, HUD");
  lines.push("  backgrounds/      # Background scene");
  lines.push("  animations/       # Win anim, transition, video");
  lines.push("  particles/        # FX / particle");
  lines.push("  atlases/          # Sprite atlas / Spine");
  lines.push("  audio/            # BGM, SFX, win sounds");
  lines.push("  config/           # Paytable, symbol def, features");
  lines.push("  js/               # Engine + game logic");
  lines.push("  css/ fonts/ images/ html/ data/ other/");
  lines.push("server/");
  lines.push("  api/              # Snapshot response API");
  lines.push("manifest.json");
  lines.push("keterangan.json");
  lines.push("KETERANGAN.md");
  lines.push("README.md");
  lines.push("```");
  lines.push("");
  lines.push("## Catatan penting");
  lines.push("");
  lines.push("- Hanya resource yang **dikirim ke browser** saat collect.");
  lines.push("- API di folder `server/` adalah **salinan response**, bukan koneksi live.");
  lines.push("- Logic server, database, DRM, multiplayer real-time **tidak** ikut.");
  lines.push("- Pakai hanya pada game yang kamu miliki / berizin.");
  lines.push("");

  const keteranganJson = {
    target,
    collectedAt: new Date().toISOString(),
    totals: {
      all: manifest.length,
      game: game.length,
      api: api.length,
      server: server.length
    },
    slotSubCategories: subCounts,
    analysisSummary: analysis?.summary || null,
    hosts: [...hosts.entries()].map(([host, info]) => ({
      host,
      count: info.count,
      categories: [...info.categories],
      samples: info.samples
    })),
    apiEndpoints,
    folders: {
      game: "assets/",
      slotSub: [
        "assets/symbols/", "assets/reels/", "assets/ui/", "assets/backgrounds/",
        "assets/animations/", "assets/particles/", "assets/atlases/",
        "assets/audio/", "assets/config/", "assets/js/", "assets/css/",
        "assets/fonts/", "assets/images/", "assets/html/", "assets/data/", "assets/other/"
      ],
      api: "server/api/",
      server: "server/",
      docs: ["KETERANGAN.md", "keterangan.json", "manifest.json", "README.md"]
    },
    note: "Asset game diklasifikasi ke sub-folder slot (symbols, reels, ui, dll). API/server = snapshot saja."
  };

  return { md: lines.join("\n"), json: keteranganJson };
}

// === Smart offline packaging helpers ===
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
  /if\s*\(\s*top\s*!=\s*self\s*\)/gi,
];

function neutralizeFrameBusters(text) {
  let out = text;
  let n = 0;
  for (const re of FRAME_BUSTER_RE) {
    out = out.replace(re, (m) => { n++; return "/* GC-PRO */ false && " + m; });
  }
  return { text: out, count: n };
}

function buildUrlToLocalMap(manifest) {
  const map = new Map();
  for (const r of manifest) {
    if (r.url && r.localPath) {
      map.set(r.url, r.localPath);
      try {
        const u = new URL(r.url);
        // Full URL
        map.set(u.href, r.localPath);
        // Protocol-relative
        map.set("//" + u.host + u.pathname + u.search, r.localPath);
        // Path + query
        map.set(u.pathname + u.search, r.localPath);
        map.set(u.pathname, r.localPath);
        // Bare filename
        const bare = u.pathname.split("/").pop();
        if (bare) {
          map.set(bare, r.localPath);
          map.set(bare + u.search, r.localPath);
        }
        // Without query for matching
        if (u.search) map.set(u.origin + u.pathname, r.localPath);
      } catch {}
    }
  }
  return map;
}

function rewriteContent(text, urlMap, isHtml) {
  let out = text;

  // 1. Full absolute + protocol-relative (longest first)
  const entries = [...urlMap.entries()]
    .filter(([k]) => k.includes("/") || k.startsWith("http") || k.startsWith("//"))
    .sort((a, b) => b[0].length - a[0].length);

  for (const [from, to] of entries) {
    if (from.length < 4) continue;
    if (out.includes(from)) out = out.split(from).join(to);
  }

  // 2. Relative path patterns common in games (src="./xxx", url(xxx), import("xxx"))
  // Map bare names that appear in zip
  const bareMap = new Map();
  for (const [k, v] of urlMap) {
    if (!k.includes("/") && k.length > 3) bareMap.set(k, v);
  }

  // 3. CSS url() rewrite
  out = out.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (m, p) => {
    const clean = p.trim().split("?")[0].split("#")[0];
    const name = clean.split("/").pop();
    if (urlMap.has(p)) return `url(${urlMap.get(p)})`;
    if (urlMap.has(clean)) return `url(${urlMap.get(clean)})`;
    if (name && bareMap.has(name)) return `url(${bareMap.get(name)})`;
    return m;
  });

  // 4. HTML src/href that still absolute
  if (isHtml) {
    out = out.replace(/(src|href|data-src|data-href)=["'](https?:\/\/[^"']+)["']/gi, (m, attr, u) => {
      if (urlMap.has(u)) return `${attr}="${urlMap.get(u)}"`;
      try {
        const path = new URL(u).pathname;
        if (urlMap.has(path)) return `${attr}="${urlMap.get(path)}"`;
        const bare = path.split("/").pop();
        if (bare && bareMap.has(bare)) return `${attr}="${bareMap.get(bare)}"`;
      } catch {}
      return m;
    });

    if (!/<base\s/i.test(out) && out.includes("<head>")) {
      out = out.replace("<head>", '<head>\n<base href="./">');
    }

    // Offline bootstrap: frame protect + soft-block external network + common game fixes
    const offlineBoot = `<script>
(function(){
  try{Object.defineProperty(window,"top",{get:function(){return window}})}catch(e){}
  try{Object.defineProperty(window,"parent",{get:function(){return window}})}catch(e){}
  window.__gc_offline=1;window.__gc_protected=1;
  var _f=window.fetch;
  window.fetch=function(u,i){
    try{
      var s=typeof u==="string"?u:(u&&u.url)||"";
      if(/^https?:\\/\\//i.test(s)&&!/^(blob:|data:)/i.test(s)){
        console.warn("[GC-Offline] blocked external:",s);
        return Promise.reject(new Error("offline"));
      }
    }catch(e){}
    return _f.apply(this,arguments);
  };
  // Soft XHR block
  var _x=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    if(typeof u==="string"&&/^https?:\\/\\//i.test(u)&&!/^(blob:|data:)/i.test(u)){
      console.warn("[GC-Offline] blocked XHR:",u);
      u="data:," ;
    }
    return _x.apply(this,arguments);
  };
})();
<\/script>`;
    if (out.includes("<head>")) out = out.replace("<head>", "<head>" + offlineBoot);
  }
  return out;
}

function extractReferencedUrls(text, baseUrl) {
  const found = new Set();
  if (!text) return found;
  const patterns = [
    /(?:src|href|data-src|data-href|poster)\s*=\s*["']([^"']+)["']/gi,
    /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /["']((?:https?:)?\/\/[^"']+\.(?:js|mjs|css|json|png|jpe?g|gif|webp|svg|woff2?|mp3|ogg|wav|mp4|webm|wasm|data))["']/gi,
    /["'](\.?\.?\/[^"']+\.(?:js|mjs|css|json|png|jpe?g|gif|webp|svg|woff2?|mp3|ogg|wav|mp4|webm|wasm|data))["']/gi,
  ];
  for (const re of patterns) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(text)) !== null) {
      const raw = (m[1] || "").trim();
      if (!raw || raw.startsWith("data:") || raw.startsWith("blob:") || raw.startsWith("#") || raw.startsWith("javascript:")) continue;
      try {
        const abs = new URL(raw, baseUrl).href;
        if (abs.startsWith("http://") || abs.startsWith("https://")) found.add(abs);
      } catch {}
    }
  }
  return found;
}

function guessTypeFromUrl(u, ct) {
  const p = u.toLowerCase();
  if (ct.includes("javascript") || /\.m?js(\?|$)/.test(p)) return "script";
  if (ct.includes("css") || /\.css(\?|$)/.test(p)) return "stylesheet";
  if (ct.includes("image") || /\.(png|jpe?g|gif|webp|svg|ico)(\?|$)/.test(p)) return "image";
  if (ct.includes("font") || /\.(woff2?|ttf|otf)(\?|$)/.test(p)) return "font";
  if (ct.includes("audio") || ct.includes("video") || /\.(mp3|ogg|wav|mp4|webm)(\?|$)/.test(p)) return "media";
  if (ct.includes("json") || /\.json(\?|$)/.test(p)) return "fetch";
  return "fetch";
}

/**
 * Poin 2 — Analisis isi file (JSON / config / atlas / API snapshot)
 * Membaca konten yang sudah ter-collect, mencari struktur slot.
 */
function analyzeGameContent(zipFiles, manifest) {
  const result = {
    scannedFiles: 0,
    parsedJson: 0,
    paytables: [],
    symbols: [],
    features: [],
    bets: [],
    atlases: [],
    spine: [],
    audioMaps: [],
    apiSnapshots: [],
    hints: [],
    summary: {}
  };

  const symbolSet = new Set();
  const featureSet = new Set();

  function tryParseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function walkObject(obj, path, visitor, depth = 0) {
    if (depth > 8 || obj == null) return;
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => walkObject(v, path + "[" + i + "]", visitor, depth + 1));
      return;
    }
    if (typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      visitor(k, v, path);
      if (v && typeof v === "object") walkObject(v, path ? path + "." + k : k, visitor, depth + 1);
    }
  }

  function looksLikePaytable(key, value) {
    const k = String(key).toLowerCase();
    if (/paytable|pay[_-]?table|payouts?|pays|win[_-]?table/i.test(k)) return true;
    if (Array.isArray(value) && value.length >= 3) {
      const sample = value.slice(0, 5);
      if (sample.every(x => typeof x === "number" || (x && typeof x === "object" && ("pay" in x || "payout" in x || "prize" in x)))) {
        return /pay|win|prize|award/i.test(k);
      }
    }
    return false;
  }

  function extractSymbolsFromValue(key, value) {
    const k = String(key).toLowerCase();
    if (!/symbol|symbols|symb|icons?|tiles?/i.test(k)) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.length < 64) symbolSet.add(item);
        else if (item && typeof item === "object") {
          const name = item.name || item.id || item.key || item.symbol || item.code;
          if (name != null) symbolSet.add(String(name));
        }
      }
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [sk, sv] of Object.entries(value)) {
        if (typeof sv === "string" || typeof sv === "number") symbolSet.add(String(sk));
        else if (sv && typeof sv === "object") {
          const name = sv.name || sv.id || sk;
          symbolSet.add(String(name));
        }
      }
    }
  }

  function extractFeatures(key, value) {
    const k = String(key).toLowerCase();
    if (/freespin|free[_-]?spin|bonus|scatter|wild|multiplier|cascade|tumble|feature|jackpot/i.test(k)) {
      featureSet.add(k);
      if (value && typeof value === "object") {
        result.features.push({
          key: k,
          pathHint: key,
          sample: Array.isArray(value) ? { type: "array", length: value.length } : { type: "object", keys: Object.keys(value).slice(0, 12) }
        });
      } else if (value != null && typeof value !== "object") {
        result.features.push({ key: k, value: value });
      }
    }
  }

  function extractBets(key, value) {
    const k = String(key).toLowerCase();
    if (!/bet|bets|stake|stakes|coin|denom|lines?|ways|level|betlevels?/i.test(k)) return;
    if (Array.isArray(value) && value.every(x => typeof x === "number")) {
      result.bets.push({ key: k, values: value.slice(0, 40) });
    } else if (typeof value === "number") {
      result.bets.push({ key: k, value });
    } else if (value && typeof value === "object") {
      result.bets.push({ key: k, keys: Object.keys(value).slice(0, 20) });
    }
  }

  // Scan semua file di ZIP
  for (const [path, data] of Object.entries(zipFiles)) {
    if (!data || typeof data === "string") continue;
    const lower = path.toLowerCase();
    const isJson = /\.json$/i.test(lower) || lower.includes("/config/") || lower.includes("server/api/");
    const isAtlas = /\.atlas$/i.test(lower);
    const isSkel = /\.(skel|spine)$/i.test(lower);
    const isJs = /\.(js|mjs)$/i.test(lower);
    if (!isJson && !isAtlas && !isSkel && !isJs) continue;
    if (data.byteLength > 2_000_000) continue; // skip file sangat besar

    let text = "";
    try {
      text = new TextDecoder().decode(data);
    } catch {
      continue;
    }
    result.scannedFiles++;

    // Spine / atlas file names
    if (isSkel) {
      result.spine.push({ path, size: data.byteLength });
      continue;
    }
    if (isAtlas) {
      result.atlases.push({ path, size: data.byteLength, format: "libgdx-atlas" });
      // Atlas text often lists texture names
      const pages = text.split("\n").filter(l => /\.(png|jpg|webp)/i.test(l)).slice(0, 20);
      if (pages.length) result.atlases[result.atlases.length - 1].textures = pages.map(l => l.trim());
      continue;
    }

    // JSON parse
    if (isJson || text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
      const json = tryParseJson(text);
      if (!json) continue;
      result.parsedJson++;

      // TexturePacker / spritesheet JSON
      if (json.frames && (json.meta || json.textures)) {
        result.atlases.push({
          path,
          format: "texturepacker",
          frameCount: Object.keys(json.frames).length,
          meta: json.meta || null
        });
      }
      if (Array.isArray(json.textures) || (json.meta && json.meta.app)) {
        result.atlases.push({ path, format: "spritesheet-json", size: data.byteLength });
      }

      // Audio sprite map (howler-style)
      if (json.sprite && typeof json.sprite === "object" && (json.urls || json.src)) {
        result.audioMaps.push({
          path,
          format: "audio-sprite",
          keys: Object.keys(json.sprite).slice(0, 50)
        });
      }

      // Walk for paytable / symbols / features / bets
      walkObject(json, "", (key, value) => {
        if (looksLikePaytable(key, value)) {
          result.paytables.push({
            file: path,
            key,
            kind: Array.isArray(value) ? "array" : typeof value,
            preview: Array.isArray(value)
              ? value.slice(0, 5)
              : (value && typeof value === "object" ? Object.keys(value).slice(0, 15) : value)
          });
        }
        extractSymbolsFromValue(key, value);
        extractFeatures(key, value);
        extractBets(key, value);
      });

      // API snapshot heuristics (server/api)
      if (path.startsWith("server/api/") || path.includes("/api/")) {
        const keys = json && typeof json === "object" && !Array.isArray(json) ? Object.keys(json) : [];
        const joined = keys.join(",").toLowerCase();
        let kind = "unknown";
        if (/balance|credit|wallet|cash/.test(joined)) kind = "balance";
        if (/spin|reel|result|outcome|winamount|winsymbol|slot/.test(joined)) kind = "spin-result";
        if (/session|token|auth|login|launch/.test(joined)) kind = "session-auth";
        if (/error|code|message/.test(joined) && keys.length <= 6) kind = "error-or-status";
        result.apiSnapshots.push({
          path,
          kind,
          topKeys: keys.slice(0, 20),
          size: data.byteLength
        });
      }
    }

    // JS: light string scan for known keys (no full parse)
    if (isJs && text.length < 500_000) {
      const symMatches = text.match(/["'](?:symbol|symb|wild|scatter|bonus)[_-]?[a-z0-9]*["']/gi);
      if (symMatches) {
        for (const m of symMatches.slice(0, 30)) {
          symbolSet.add(m.replace(/["']/g, ""));
        }
      }
      if (/paytable|payTable|PAYTABLE/i.test(text)) {
        result.hints.push({ file: path, hint: "paytable-reference-in-js" });
      }
      if (/freeSpin|free_spin|FreeSpin|scatter|cascad|tumble/i.test(text)) {
        result.hints.push({ file: path, hint: "feature-reference-in-js" });
      }
    }
  }

  result.symbols = [...symbolSet].slice(0, 200);
  // dedupe features by key
  const featKeys = new Set();
  result.features = result.features.filter(f => {
    const k = f.key || "";
    if (featKeys.has(k)) return false;
    featKeys.add(k);
    return true;
  }).slice(0, 50);

  result.summary = {
    jsonParsed: result.parsedJson,
    paytableHits: result.paytables.length,
    symbolCount: result.symbols.length,
    featureHits: result.features.length,
    betConfigs: result.bets.length,
    atlasCount: result.atlases.length,
    spineCount: result.spine.length,
    audioMapCount: result.audioMaps.length,
    apiSnapshotCount: result.apiSnapshots.length,
    note: "Hasil heuristik dari isi file yang ter-collect. Bukan reverse-engineer server."
  };

  return result;
}

async function fillMissingAssets(zipFiles, manifest, seen, targetHref, id, env) {
  const report = { scanned: 0, missingFound: 0, fetched: 0, failed: 0, stillMissing: [] };
  const texts = [];
  for (const [key, data] of Object.entries(zipFiles)) {
    if (!/\.(html?|js|mjs|css)$/i.test(key) && key !== "index.html") continue;
    try {
      texts.push(new TextDecoder().decode(data));
      report.scanned++;
    } catch {}
  }
  const needed = new Set();
  for (const t of texts) {
    for (const u of extractReferencedUrls(t, targetHref)) needed.add(u);
  }
  const missing = [...needed].filter(u => !seen.has(u) && !isExcluded(u));
  report.missingFound = missing.length;

  // Cap secondary fetches to stay within worker limits
  const MAX_FILL = 40;
  for (const u of missing.slice(0, MAX_FILL)) {
    try {
      const res = await fetch(u, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; GameCollectorPro/1.0)", "Accept": "*/*" },
        redirect: "follow"
      });
      if (!res.ok) {
        report.failed++;
        report.stillMissing.push({ url: u, error: "status " + res.status });
        continue;
      }
      const buffer = new Uint8Array(await res.arrayBuffer());
      if (!buffer.byteLength) {
        report.failed++;
        report.stillMissing.push({ url: u, error: "empty" });
        continue;
      }
      const ct = res.headers.get("content-type") || "";
      const type = guessTypeFromUrl(u, ct);
      let name = safe(new URL(u).pathname.split("/").pop() || "file");
      if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
        if (type === "script") name += ".js";
        else if (type === "stylesheet") name += ".css";
        else if (type === "image") name += ".bin";
        else if (ct.includes("json")) name += ".json";
      }
      const classified = classifyResource(u, type, ct, "");
      const slot = classified.category === "game"
        ? classifySlotSubfolder(u, type, ct)
        : { sub: null, reason: "" };
      const folder = folderOf(type, classified.category, slot.sub);
      const localPath = `${folder}/${String(manifest.length + 1).padStart(4, "0")}-fill-${name}`;
      zipFiles[localPath] = buffer;
      seen.add(u);
      manifest.push({
        url: u,
        type,
        status: res.status,
        localPath,
        size: buffer.byteLength,
        contentType: ct,
        category: classified.category,
        subCategory: slot.sub || null,
        classifyReason: classified.reason + (slot.reason ? "+" + slot.reason : "") + "+auto-fill",
        autoFilled: true
      });
      report.fetched++;
    } catch (e) {
      report.failed++;
      report.stillMissing.push({ url: u, error: String(e.message || e).slice(0, 120) });
    }
  }
  for (const u of missing.slice(MAX_FILL)) {
    report.stillMissing.push({ url: u, error: "skipped-limit" });
  }
  return report;
}

function smartPackage(zipFiles, manifest) {
  const urlMap = buildUrlToLocalMap(manifest);
  const result = { rewritten: 0, neutralized: 0 };
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
        text = rewriteContent(text, urlMap, isHtml);
      }
      // JS import / dynamic import / require
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
      // JSON walk for URL strings
      if (isJson) {
        try {
          let j = JSON.parse(text);
          let touched = false;
          const walk = (obj) => {
            if (typeof obj === "string") {
              if (urlMap.has(obj)) { touched = true; return urlMap.get(obj); }
              try {
                const u = new URL(obj);
                const bare = u.pathname.split("/").pop();
                if (bare && bareMap.has(bare)) { touched = true; return bareMap.get(bare); }
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
      }
      if (text !== before) {
        zipFiles[key] = strToU8(text);
        result.rewritten++;
      }
    } catch {}
  }
  return result;
}

const GH_OWNER = "frostbyte-lab";
const GH_REPO = "frostbyte-lab-game--collector";
const GH_WORKFLOW = "collect.yml";

async function ghFetch(env, path, opts = {}) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    return { ok: false, status: 500, data: { error: "GITHUB_TOKEN belum di-set di Worker secrets" } };
  }
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "game-collector-pro",
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data, headers: res.headers };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health
    if (request.method === "GET" && url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "game-collector-pro",
        version: "4.1",
        github: Boolean(env.GITHUB_TOKEN)
      });
    }

    // --- Trigger GitHub Actions collect from web ---
    if (request.method === "POST" && url.pathname === "/api/github/collect") {
      let body;
      try { body = await request.json(); } catch {
        return Response.json({ error: "JSON tidak valid" }, { status: 400 });
      }
      const gameUrl = String(body.url || "").trim();
      const waitSeconds = String(body.wait_seconds || "8");
      try {
        const u = new URL(gameUrl);
        if (!["http:", "https:"].includes(u.protocol)) throw 0;
      } catch {
        return Response.json({ error: "URL http/https tidak valid" }, { status: 400 });
      }

      const dispatch = await ghFetch(env, `/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: "main",
          inputs: { url: gameUrl, wait_seconds: waitSeconds }
        })
      });

      if (dispatch.status === 204 || dispatch.ok) {
        // Ambil run terbaru (sedikit delay di client; di sini coba list)
        await new Promise(r => setTimeout(r, 1500));
        const runs = await ghFetch(env, `/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/runs?per_page=5&event=workflow_dispatch`);
        const run = runs.data?.workflow_runs?.[0] || null;
        return Response.json({
          ok: true,
          message: "GitHub Actions dimulai. Tunggu 1–3 menit, lalu cek status.",
          run_id: run?.id || null,
          run_url: run?.html_url || `https://github.com/${GH_OWNER}/${GH_REPO}/actions`,
          status: run?.status || "queued",
          conclusion: run?.conclusion || null
        });
      }
      return Response.json({
        error: "Gagal trigger GitHub Actions",
        detail: dispatch.data
      }, { status: dispatch.status || 500 });
    }

    // --- Cek status run ---
    if (request.method === "GET" && url.pathname === "/api/github/status") {
      const runId = url.searchParams.get("run_id");
      if (!runId) return Response.json({ error: "run_id wajib" }, { status: 400 });
      const run = await ghFetch(env, `/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}`);
      if (!run.ok) return Response.json({ error: "Gagal ambil status", detail: run.data }, { status: run.status });
      const r = run.data;

      // Detail job + steps (apa yang sedang dijalankan)
      let jobsOut = [];
      let currentStep = null;
      try {
        const jobs = await ghFetch(env, `/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}/jobs`);
        const list = jobs.data?.jobs || [];
        for (const job of list) {
          const steps = (job.steps || []).map(s => ({
            name: s.name,
            status: s.status,
            conclusion: s.conclusion,
            number: s.number
          }));
          jobsOut.push({
            name: job.name,
            status: job.status,
            conclusion: job.conclusion,
            steps
          });
          for (const s of steps) {
            if (s.status === "in_progress") currentStep = s.name;
          }
          if (!currentStep && job.status === "in_progress") {
            const last = [...steps].reverse().find(s => s.conclusion === "success") || steps[steps.length - 1];
            if (last) currentStep = last.name + (last.conclusion === "success" ? " (selesai, lanjut...)" : "");
          }
        }
      } catch {}

      // Fase ramah pengguna dari nama step
      const phaseHint = (() => {
        const n = (currentStep || "").toLowerCase();
        if (!n && r.status === "queued") return "Antri di GitHub Actions...";
        if (n.includes("checkout") || n.includes("set up job")) return "Menyiapkan runner & clone repo";
        if (n.includes("setup node") || n.includes("install")) return "Install Node + Playwright (browser)";
        if (n.includes("capture") || n.includes("collect")) return "Membuka URL game, scroll, ambil HTML/JS/CSS/gambar/audio, packaging ZIP";
        if (n.includes("upload") || n.includes("artifact")) return "Upload artifact ZIP ke GitHub";
        if (n.includes("summary")) return "Menulis ringkasan hasil";
        if (r.status === "completed") return r.conclusion === "success" ? "Selesai" : "Gagal";
        return currentStep ? ("Menjalankan: " + currentStep) : "Sedang diproses di runner GitHub...";
      })();

      let artifact = null;
      if (r.status === "completed" && r.conclusion === "success") {
        const arts = await ghFetch(env, `/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}/artifacts`);
        artifact = arts.data?.artifacts?.[0] || null;
      }
      return Response.json({
        ok: true,
        run_id: r.id,
        status: r.status,
        conclusion: r.conclusion,
        html_url: r.html_url,
        run_started_at: r.run_started_at || r.created_at,
        updated_at: r.updated_at,
        current_step: currentStep,
        phase: phaseHint,
        jobs: jobsOut,
        artifact: artifact ? { id: artifact.id, name: artifact.name, size: artifact.size_in_bytes } : null
      });
    }

    // --- Download artifact ZIP (proxy) ---
    if (request.method === "GET" && url.pathname === "/api/github/artifact") {
      const artifactId = url.searchParams.get("artifact_id");
      if (!artifactId) return Response.json({ error: "artifact_id wajib" }, { status: 400 });
      const token = env.GITHUB_TOKEN;
      if (!token) return Response.json({ error: "GITHUB_TOKEN belum di-set" }, { status: 500 });
      const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/artifacts/${artifactId}/zip`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "game-collector-pro"
        },
        redirect: "follow"
      });
      if (!res.ok) {
        const t = await res.text();
        return Response.json({ error: "Gagal download artifact", detail: t.slice(0, 300) }, { status: res.status });
      }
      return new Response(res.body, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="game-resources.zip"'
        }
      });
    }

    // Cloudflare browser collect
    if (request.method !== "POST" || url.pathname !== "/api/collect") {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "JSON tidak valid" }, { status: 400 });
    }

    let target;
    try {
      target = new URL(String(body.url || ""));
      if (!["http:", "https:"].includes(target.protocol)) throw 0;
    } catch {
      return Response.json({ error: "URL http/https tidak valid" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const manifest = [];
    const seen = new Set();
    const zipFiles = {};

    let browser;
    try {
      // === Launch browser (ini yang kena limit Cloudflare Free) ===
      try {
        browser = await launch(env.MYBROWSER);
      } catch (launchErr) {
        const msg = String(launchErr.message || launchErr);
        if (msg.includes("429") || msg.includes("Rate limit") || msg.includes("limit exceeded")) {
          return Response.json({
            error: "LIMIT_BROWSER",
            message: "Limit browser Cloudflare Free (10 menit/hari) sudah tercapai. Coba lagi besok, atau gunakan GitHub Actions (gratis tanpa limit).",
            tip: "Buka repo GitHub → Actions → Run workflow"
          }, { status: 429 });
        }
        throw launchErr;
      }

      const page = await browser.newPage();

      // Collect network resources
      page.on("response", async (response) => {
        try {
          const req = response.request();
          const type = req.resourceType();
          if (!TYPES.has(type)) return;

          const u = response.url();
          if (seen.has(u) || isExcluded(u)) return;
          if (u.startsWith("data:") || u.startsWith("blob:")) return;
          seen.add(u);

          if (response.status() >= 400) return;

          const buffer = await response.body();
          if (!buffer || buffer.byteLength === 0) return;

          const ct = response.headers()["content-type"] || "";
          let name = safe(new URL(u).pathname.split("/").pop() || "index");
          if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
            if (ct.includes("javascript")) name += ".js";
            else if (ct.includes("css")) name += ".css";
            else if (ct.includes("html")) name += ".html";
            else if (ct.includes("json")) name += ".json";
            else if (ct.includes("png")) name += ".png";
            else if (ct.includes("jpeg") || ct.includes("jpg")) name += ".jpg";
            else if (ct.includes("webp")) name += ".webp";
            else if (ct.includes("woff2")) name += ".woff2";
            else if (ct.includes("woff")) name += ".woff";
          }

          // Peek body text for JSON classification (limit)
          let bodyPeek = "";
          try {
            if ((ct.includes("json") || ct.includes("text") || type === "xhr" || type === "fetch") && buffer.byteLength < 500000) {
              bodyPeek = new TextDecoder().decode(buffer.slice(0, 400));
            }
          } catch {}

          const classified = classifyResource(u, type, ct, bodyPeek);
          const slot = classified.category === "game"
            ? classifySlotSubfolder(u, type, ct)
            : { sub: null, reason: "" };
          const folder = folderOf(type, classified.category, slot.sub);
          const localPath = `${folder}/${String(manifest.length + 1).padStart(4, "0")}-${name}`;
          const r2Key = `${id}/${localPath}`;

          if (env.COLLECTOR_BUCKET) {
            await env.COLLECTOR_BUCKET.put(r2Key, buffer, {
              httpMetadata: { contentType: ct || "application/octet-stream" }
            });
          }

          zipFiles[localPath] = new Uint8Array(buffer);
          manifest.push({
            url: u,
            type,
            status: response.status(),
            localPath,
            size: buffer.byteLength,
            contentType: ct,
            category: classified.category,
            subCategory: slot.sub || null,
            classifyReason: classified.reason + (slot.reason ? "+" + slot.reason : "")
          });
        } catch {}
      });

      // Navigate
      await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 40000 });
      await page.waitForTimeout(3000);

      // === Auto-click Play / Start / Mulai / Continue buttons ===
      try {
        await page.evaluate(async () => {
          const keywords = [
            "play", "start", "mulai", "continue", "lanjut", "main", "go", "enter",
            "tap to play", "click to play", "klik untuk main", "start game", "play now",
            "mulai game", "lanjutkan", "ok", "yes", "accept", "agree"
          ];
          const candidates = [];
          const all = document.querySelectorAll("button, a, div, span, input[type=button], [role=button], .btn, .button");
          for (const el of all) {
            const text = ((el.textContent || "") + " " + (el.getAttribute("aria-label") || "") + " " + (el.id || "") + " " + (el.className || "")).toLowerCase();
            if (keywords.some(k => text.includes(k))) {
              const style = window.getComputedStyle(el);
              if (style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null) {
                candidates.push(el);
              }
            }
          }
          // Prefer larger / more centered buttons
          candidates.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return (rb.width * rb.height) - (ra.width * ra.height);
          });
          for (const el of candidates.slice(0, 3)) {
            try {
              el.click();
              await new Promise(r => setTimeout(r, 800));
            } catch {}
          }
        });
        await page.waitForTimeout(2000);
      } catch {}

      // Coba deteksi & masuk ke iframe jika ada
      try {
        const frames = page.frames();
        for (const frame of frames) {
          if (frame === page.mainFrame()) continue;
          const frameUrl = frame.url();
          if (frameUrl && frameUrl !== "about:blank" && !frameUrl.startsWith("chrome")) {
            await frame.evaluate(() => {
              window.scrollTo(0, document.body?.scrollHeight || 0);
            }).catch(() => {});
            // Auto-click play di dalam iframe juga
            try {
              await frame.evaluate(() => {
                const kws = ["play", "start", "mulai", "continue", "main"];
                document.querySelectorAll("button, a, div, [role=button]").forEach(el => {
                  const t = ((el.textContent || "") + " " + (el.className || "")).toLowerCase();
                  if (kws.some(k => t.includes(k))) try { el.click(); } catch {}
                });
              });
            } catch {}
          }
        }
      } catch {}

      // Scroll halaman utama (trigger lazy load)
      await page.evaluate(async () => {
        const total = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0, 2000);
        for (let y = 0; y < total; y += 700) {
          window.scrollTo(0, y);
          await new Promise(r => setTimeout(r, 180));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(2500);

      // Ambil HTML
      let html = await page.content();
      zipFiles["index.html"] = strToU8(html);

      // Pass 2: scan referensi yang belum ter-download → auto-fetch yang kurang
      let fillReport = { scanned: 0, missingFound: 0, fetched: 0, failed: 0, stillMissing: [] };
      try {
        fillReport = await fillMissingAssets(zipFiles, manifest, seen, target.href, id, env);
      } catch (e) {
        fillReport.error = String(e.message || e);
      }

      // Smart offline packaging: path rewrite + frame-buster neutralize
      const smart = smartPackage(zipFiles, manifest);

      // Poin 2: analisis isi JSON/config/atlas/API snapshot
      let analysis = null;
      try {
        analysis = analyzeGameContent(zipFiles, manifest);
      } catch (e) {
        analysis = { error: String(e.message || e), summary: {} };
      }

      // Keterangan + pemisahan game vs API/server
      const ket = buildKeterangan(target.href, manifest, smart, analysis);
      const gameCount = manifest.filter(r => r.category === "game").length;
      const apiCount = manifest.filter(r => r.category === "api").length;
      const serverCount = manifest.filter(r => r.category === "server").length;

      const manifestData = {
        target: target.href,
        collectedAt: new Date().toISOString(),
        totalFiles: manifest.length,
        totals: { game: gameCount, api: apiCount, server: serverCount },
        smartRewrite: smart,
        autoFill: fillReport,
        analysisSummary: analysis?.summary || null,
        note: "Asset game di assets/ (sub-folder slot). API/server di server/. Lihat KETERANGAN.md + analisis.json.",
        resources: manifest
      };
      zipFiles["manifest.json"] = strToU8(JSON.stringify(manifestData, null, 2));
      zipFiles["keterangan.json"] = strToU8(JSON.stringify(ket.json, null, 2));
      zipFiles["KETERANGAN.md"] = strToU8(ket.md);
      zipFiles["analisis.json"] = strToU8(JSON.stringify(analysis, null, 2));
      zipFiles["kelengkapan.json"] = strToU8(JSON.stringify({
        autoFill: fillReport,
        summary: {
          referencedMissing: fillReport.missingFound,
          autoDownloaded: fillReport.fetched,
          failedOrSkipped: (fillReport.stillMissing || []).length,
          note: fillReport.fetched
            ? "Beberapa file yang kurang berhasil dilengkapi otomatis sebelum ZIP dibuat."
            : "Tidak ada file tambahan yang berhasil di-fetch, atau semua referensi sudah lengkap."
        },
        stillMissing: fillReport.stillMissing || []
      }, null, 2));

      zipFiles["README.md"] = strToU8(`# Game Resource Package (Game Collector Pro)
Target: ${target.href}
Tanggal: ${new Date().toISOString()}
Total: ${manifest.length} file (game: ${gameCount} · api: ${apiCount} · server: ${serverCount})
Smart rewrite: ${smart.rewritten} · frame-buster: ${smart.neutralized}
Analisis: paytable=${analysis?.summary?.paytableHits ?? 0} · symbols=${analysis?.summary?.symbolCount ?? 0} · features=${analysis?.summary?.featureHits ?? 0} · atlas=${analysis?.summary?.atlasCount ?? 0}

## Pemisahan otomatis
- \`assets/\` — asset game (symbols, reels, ui, audio, config, ...)
- \`server/api/\` — snapshot response API (terpisah dari game)
- \`analisis.json\` — hasil parsing paytable / symbol / feature / atlas (Poin 2)
- \`KETERANGAN.md\` — deskripsi host, endpoint, kategori + sub-folder

## Cara pakai
1. Baca **KETERANGAN.md** dan **analisis.json** dulu
2. Extract ZIP → \`npx serve .\` atau load di Workspace Game Collector Pro
3. Preview / Auto Repair / Online Hybrid

> API di folder server/ hanya snapshot saat collect, bukan backend live.
`);

      await browser.close();
      browser = null;

      // Buat ZIP
      const zipData = zipSync(zipFiles, { level: 6 });
      const zipKey = `${id}/game-package.zip`;

      // Simpan ke R2 jika bucket sudah di-bind (opsional)
      if (env.COLLECTOR_BUCKET) {
        await env.COLLECTOR_BUCKET.put(zipKey, zipData, {
          httpMetadata: {
            contentType: "application/zip",
            contentDisposition: `attachment; filename="game-package-${id}.zip"`
          }
        });
      }

      // Selalu kirim ZIP sebagai binary (bukan base64) — mendukung file besar tanpa R2
      // Metadata lewat header supaya frontend tetap bisa menampilkan status
      return new Response(zipData, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="game-package-${id}.zip"`,
          "X-GC-Ok": "1",
          "X-GC-Id": id,
          "X-GC-Files": String(manifest.length),
          "X-GC-Zip-Size": String(zipData.byteLength),
          "X-GC-Smart-Rewritten": String(smart.rewritten || 0),
          "X-GC-Smart-Neutralized": String(smart.neutralized || 0),
          "X-GC-Game-Files": String(gameCount),
          "X-GC-Api-Files": String(apiCount),
          "X-GC-Server-Files": String(serverCount),
          "X-GC-Fill-Found": String(fillReport.missingFound || 0),
          "X-GC-Fill-Ok": String(fillReport.fetched || 0),
          "X-GC-Fill-Fail": String(fillReport.failed || 0),
          "X-GC-Message": `Capture berhasil. ZIP ${Math.round(zipData.byteLength / 1024)} KB · game ${gameCount} · api ${apiCount} · server ${serverCount}.`
        }
      });

    } catch (e) {
      try { if (browser) await browser.close(); } catch {}
      const msg = String(e.message || e);
      if (msg.includes("429") || msg.includes("Rate limit") || msg.includes("limit exceeded")) {
        return Response.json({
          error: "LIMIT_BROWSER",
          message: "Limit browser Cloudflare Free sudah tercapai (10 menit/hari). Coba lagi besok atau pakai GitHub Actions.",
        }, { status: 429 });
      }
      return Response.json({ error: msg }, { status: 500 });
    }
  }
};
