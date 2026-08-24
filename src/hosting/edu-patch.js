/**
 * Auto-patch paket game sebelum commit ke Edu-network:
 * - rewrite base URL API → EDU Pages
 * - inject SDK edu-game-client.js + bootstrap gameId = slot
 * - normalisasi path /api/... yang sering dipakai slot provider
 */

const DEFAULT_EDU_BASE = "https://ea29118c.edu-network.pages.dev";

/** Domain/host yang sering muncul di game hasil collect — diganti ke EDU */
const PROVIDER_HOST_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)*(?:pgsoft|pragmatic|habanero|spadegaming|jili|jokergaming|fastspin|cq9|hacksaw|relax|playtech|evolution|netent|redtiger|btg|nolimit|pushgaming|playngo|yggdrasil|thunderkick|blueprint|microgaming|isoftbet|fugaso|booming|spinomenal|kalamba|slotmill|avatarux|fantasma|gamomat|novomatic|greentube|amatic|egt|apollo|wazdan|endorphina|platipus|tomhorn|betsoft|rival|nextgen|igtech|softswiss|slotegrator|aggregator|gameprovider|cdn-games|slot-cdn)[a-z0-9.-]*/gi;

/** Pola generic API base di config JS */
const API_BASE_ASSIGN_RE =
  /\b((?:const|let|var)\s+(?:API_BASE|API_URL|BASE_URL|SERVER_URL|HOST_URL|apiBase|apiUrl|baseUrl|serverUrl)\s*=\s*)(["'`])https?:\/\/[^"'`]+?\2/gi;

const FETCH_ABSOLUTE_API_RE =
  /fetch\s*\(\s*(["'`])https?:\/\/[^"'`]+?(\/api\/[^"'`]*)\1/gi;

const XHR_OPEN_RE =
  /\.open\s*\(\s*(["'`][^"'`]*["'`])\s*,\s*(["'`])https?:\/\/[^"'`]+?(\/api\/[^"'`]*)\2/gi;

function utf8Decode(bytes) {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

function utf8Encode(str) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str);
  }
  const utf8 = unescape(encodeURIComponent(str));
  const out = new Uint8Array(utf8.length);
  for (let i = 0; i < utf8.length; i++) out[i] = utf8.charCodeAt(i);
  return out;
}

function isTextPath(path) {
  return /\.(html?|js|mjs|cjs|json|txt|css|svg|xml|map)$/i.test(path);
}

function isBinaryLikely(bytes) {
  const n = Math.min(bytes.length, 512);
  let nulls = 0;
  for (let i = 0; i < n; i++) if (bytes[i] === 0) nulls++;
  return nulls > 2;
}

/**
 * Path absolut root (/shared/, /assets/, ...) gagal di blob: preview & di /game-N/ Pages.
 * Ubah jadi relatif agar resolve ke folder game.
 */
function rewriteRootAbsolutePaths(text, changes) {
  let out = text;
  // "/shared/..." '/shared/...' `/shared/...`
  const rootDirs =
    "shared|assets|static|resource|resources|cdn|files|game|games|media|res|bundle|bundles|dist|build|public|data|config|configs|symbols|spine|atlas|audio|sound|sounds|img|images|texture|textures";
  const re = new RegExp(
    `(["'\`])\\/(${rootDirs})(\\/[^"'\`\\s]*)?\\1`,
    "gi"
  );
  out = out.replace(re, (full, q, dir, rest) => {
    changes.push("root_abs_path");
    return q + "./" + dir + (rest || "") + q;
  });
  // JSON without quotes edge: "url":"/shared/...
  out = out.replace(
    new RegExp(`(:\\s*)"\\/(${rootDirs})(/[^"]*)"`, "gi"),
    (full, pre, dir, rest) => {
      changes.push("root_abs_path_json");
      return `${pre}"./${dir}${rest || ""}"`;
    }
  );
  // CSS url(/shared/...)
  out = out.replace(
    new RegExp(`url\\(\\s*(['"]?)\\/(${rootDirs})(/[^)'"]*)\\1\\s*\\)`, "gi"),
    (full, q, dir, rest) => {
      changes.push("root_abs_path_css");
      return `url(${q || ""}./${dir}${rest || ""}${q || ""})`;
    }
  );
  return out;
}

/** Perbaiki host patah hasil rewrite: https://api./path */
function fixBrokenHosts(text, eduBase, changes) {
  let out = text;
  const base = String(eduBase || DEFAULT_EDU_BASE).replace(/\/$/, "");
  // https://api./xxx  or https://api.  (empty host label)
  out = out.replace(/https?:\/\/api\.(\/|"|'|`|\s|$)/gi, (m, tail) => {
    changes.push("fix_broken_api_host");
    if (tail === "/" || tail.startsWith("/")) return base + (tail === "/" ? "/" : tail);
    return base + (tail || "");
  });
  // generic: https://something./path (dot before slash)
  out = out.replace(/https?:\/\/([a-z0-9-]+)\.(\/)/gi, (m, host, slash) => {
    if (host === "www" || host.length < 2) return m;
    changes.push("fix_dot_host");
    // jangan sentuh domain valid tld — hanya pola patah "api./"
    return m;
  });
  // what-is-my-ip / geo stubs → relative no-op path di EDU (hindari invalid URL)
  out = out.replace(
    /https?:\/\/[^"'`\s]*what-is-my-ip[^"'`\s]*/gi,
    () => {
      changes.push("strip_geo_ip");
      return base + "/api/game/health";
    }
  );
  return out;
}

/**
 * Rewrite string content to point API traffic at EDU base + fix absolute paths.
 * @returns {{ text: string, changes: string[] }}
 */
export function rewriteApiContent(text, eduBase, gameId) {
  const base = String(eduBase || DEFAULT_EDU_BASE).replace(/\/$/, "");
  const changes = [];
  let out = text;

  // 0) path absolut root → relatif (preview blob + /game-N/)
  out = rewriteRootAbsolutePaths(out, changes);

  // 0b) host patah + geo IP
  out = fixBrokenHosts(out, base, changes);

  // 1) assignment API_BASE = "https://..."
  out = out.replace(API_BASE_ASSIGN_RE, (full, prefix, quote) => {
    changes.push("api_base_assign");
    return prefix + quote + base + quote;
  });

  // 2) fetch("https://provider.../api/...")
  out = out.replace(FETCH_ABSOLUTE_API_RE, (full, q, path) => {
    changes.push("fetch_absolute");
    return `fetch(${q}${base}${path}${q}`;
  });

  // 3) xhr.open(..., "https://provider.../api/...")
  out = out.replace(XHR_OPEN_RE, (full, methodPart, q, path) => {
    changes.push("xhr_open");
    return `.open(${methodPart}, ${q}${base}${path}${q}`;
  });

  // 4) known provider hosts → EDU
  out = out.replace(PROVIDER_HOST_RE, () => {
    changes.push("provider_host");
    return base;
  });

  // 5) game id
  if (gameId) {
    const gid = String(gameId);
    const gidRe =
      /(["']?(?:game_id|gameId|gameID|game_slug)["']?\s*[:=]\s*)(["'`])[^"'`]{0,64}\2/g;
    let gidHits = 0;
    out = out.replace(gidRe, (full, prefix, quote) => {
      gidHits++;
      return prefix + quote + gid + quote;
    });
    if (gidHits) changes.push(`game_id_x${gidHits}`);
  }

  return { text: out, changes: [...new Set(changes)] };
}

function buildBootstrapSnippet(eduBase, gameId) {
  const base = String(eduBase || DEFAULT_EDU_BASE).replace(/\/$/, "");
  const gid = String(gameId || "game-1");
  return `
<!-- EDU Network auto-patch -->
<script src="${base}/sdk/edu-game-client.js"></script>
<script>
(function(){
  var EDU_BASE = ${JSON.stringify(base)};
  var EDU_GAME_ID = ${JSON.stringify(gid)};
  var ROOT_RE = /^\\/(shared|assets|static|resource|resources|cdn|files|media|res|bundle|data|config|symbols|spine|atlas|audio|sound|img|images|texture)\\//i;
  function fixUrl(u) {
    if (!u || typeof u !== "string") return u;
    if (ROOT_RE.test(u)) return "." + u;
    if (/^https?:\\/\\/api\\.\\//i.test(u)) return EDU_BASE + u.replace(/^https?:\\/\\/api\\./i, "");
    if (/what-is-my-ip/i.test(u)) return EDU_BASE + "/api/game/health";
    return u;
  }
  try {
    var _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      var args = Array.prototype.slice.call(arguments);
      if (typeof args[1] === "string") args[1] = fixUrl(args[1]);
      return _open.apply(this, args);
    };
  } catch (e1) {}
  try {
    var _fetch = window.fetch;
    if (typeof _fetch === "function") {
      window.fetch = function(input, init) {
        if (typeof input === "string") input = fixUrl(input);
        else if (input && typeof input.url === "string") {
          try { input = new Request(fixUrl(input.url), input); } catch (_) {}
        }
        return _fetch.call(this, input, init);
      };
    }
  } catch (e2) {}
  try {
    window.EDU_API_BASE = EDU_BASE;
    window.EDU_GAME_ID = EDU_GAME_ID;
    if (typeof EduGameClient === "function" && !window.__eduClient) {
      window.__eduClient = new EduGameClient({ baseUrl: EDU_BASE, gameId: EDU_GAME_ID });
    }
  } catch (e) { console.warn("[EDU patch]", e); }
})();
</script>
<!-- /EDU Network auto-patch -->
`;
}

/**
 * Inject SDK + bootstrap before </head> or </body> or at start of HTML.
 */
export function injectSdkIntoHtml(html, eduBase, gameId) {
  if (/edu-game-client\.js/i.test(html) && /EDU_GAME_ID|__eduClient/i.test(html)) {
    return { html, injected: false };
  }
  const snippet = buildBootstrapSnippet(eduBase, gameId);
  let out = html;
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, snippet + "</head>");
  } else if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, snippet + "</body>");
  } else {
    out = snippet + out;
  }
  return { html: out, injected: true };
}


/** Paksa saldo/kredit hardcode besar → 0 */
export function zeroClientBalances(text) {
  let out = text;
  const changes = [];
  const a = out.replace(
    /\b(balance|credits?|credit|cash|coins?|saldo|money|chip|chips|wallet|userBalance|playerBalance|totalCredit|totalBalance|defaultBalance|startBalance|initBalance|initialBalance|START_BALANCE|DEFAULT_BALANCE|INIT_BALANCE|DEFAULT_CREDIT|START_CREDIT)\b(\s*[:=]\s*)(?:[\d_]{4,}|\d{1,3}(?:[.,]\d{3})+)(\s*[;,]?)/gi,
    (m, k, mid, tail) => { changes.push("balance_zero"); return k + mid + "0" + (tail || ""); }
  );
  if (a !== out) out = a;
  const b = out.replace(
    /("(?:balance|credits?|credit|cash|coins?|saldo|money|chip|chips|wallet)"\s*:\s*)(?:[\d_]{4,}|\d{1,3}(?:[.,]\d{3})+)/gi,
    (m, pre) => { changes.push("balance_zero_json"); return pre + "0"; }
  );
  if (b !== out) out = b;
  const c = out.replace(
    /\b(setBalance|updateBalance|setCredit|setCredits|setCash|setCoin|setCoins|setSaldo)\s*\(\s*(?:[\d_]{4,}|\d{1,3}(?:[.,]\d{3})+|\d+e\d+)\s*\)/gi,
    (m, fn) => { changes.push("balance_zero_fn"); return fn + "(0)"; }
  );
  if (c !== out) out = c;
  return { text: out, changes: [...new Set(changes)] };
}

/**
 * RNG level inject:
 * 1 = down (player cenderung kalah) — Math.random bias rendah untuk win
 * 2 = imbang (default)
 * 3 = menang — bias tinggi
 */
export function buildRngSnippet(level) {
  const lv = [1, 2, 3].includes(Number(level)) ? Number(level) : 2;
  return `
<script>
/* EDU RNG level ${lv} — 1=down 2=imbang 3=menang */
(function(){
  window.__EDU_RNG_LEVEL__ = ${lv};
  var _r = Math.random.bind(Math);
  if (${lv} === 2) return;
  Math.random = function(){
    var x = _r();
    if (${lv} === 1) {
      // bias ke nilai rendah / kurang menguntungkan di banyak engine
      return x * x;
    }
    // level 3: bias tinggi
    return Math.sqrt(x);
  };
})();
</script>`;
}


/**
 * Patch seluruh map path → Uint8Array.
 * @param {Record<string, Uint8Array>} files
 * @param {{ eduBase?: string, gameId?: string }} opts
 */
export function patchFilesForEdu(files, opts = {}) {
  const eduBase = (opts.eduBase || DEFAULT_EDU_BASE).replace(/\/$/, "");
  const gameId = opts.gameId || "game-1";
  const gameTitle = opts.gameTitle || gameId;
  const rngLevel = [1, 2, 3].includes(Number(opts.rngLevel)) ? Number(opts.rngLevel) : 2;
  const zeroBalance = opts.zeroBalance !== false;
  const report = {
    scanned: 0,
    patched: 0,
    injectedHtml: [],
    files: [],
    eduBase,
    gameId,
    gameTitle,
    rngLevel,
    zeroBalance,
    systems: []
  };

  const out = { ...files };

  for (const [path, data] of Object.entries(files)) {
    if (!(data instanceof Uint8Array)) continue;
    if (!isTextPath(path) || isBinaryLikely(data)) continue;
    report.scanned++;

    let text = utf8Decode(data);
    const { text: rewritten, changes } = rewriteApiContent(text, eduBase, gameId);
    text = rewritten;
    let fileChanges = [...changes];

    if (zeroBalance) {
      const zb = zeroClientBalances(text);
      text = zb.text;
      fileChanges.push(...zb.changes);
    }

    if (/\.html?$/i.test(path)) {
      const inj = injectSdkIntoHtml(text, eduBase, gameId);
      text = inj.html;
      if (inj.injected) {
        fileChanges.push("sdk_inject");
        report.injectedHtml.push(path);
      }
      // RNG inject once per html
      if (!/__EDU_RNG_LEVEL__/.test(text)) {
        const rng = buildRngSnippet(rngLevel);
        if (/<\/head>/i.test(text)) text = text.replace(/<\/head>/i, rng + "</head>");
        else text = rng + text;
        fileChanges.push("rng_level_" + rngLevel);
      }
      // meta title hint
      if (gameTitle && !/edu-meta-title/i.test(text)) {
        text = text.replace(/<title>[^<]*<\/title>/i, "<title>" + String(gameTitle).replace(/</g, "") + "</title>");
        fileChanges.push("title");
      }
    }

    if (fileChanges.length) {
      out[path] = utf8Encode(text);
      report.patched++;
      report.files.push({ path, changes: [...new Set(fileChanges)] });
    }
  }

  // edu-meta.json for EDU catalog
  try {
    const meta = {
      game_id: gameId,
      title: gameTitle,
      origin: eduBase,
      rng_level: rngLevel,
      zero_balance: zeroBalance,
      patched_at: new Date().toISOString(),
      published: true
    };
    out["edu-meta.json"] = utf8Encode(JSON.stringify(meta, null, 2) + "\n");
    report.files.push({ path: "edu-meta.json", changes: ["meta"] });
    report.patched++;
  } catch (_) {}

  report.systems = [
    { id: "api", label: "Custom API EDU", ok: report.files.some(f => (f.changes||[]).some(c => /api|fetch|xhr|provider/i.test(c))) || report.patched > 0 },
    { id: "domain", label: "Domain EDU", ok: true, value: eduBase },
    { id: "sdk", label: "SDK inject", ok: report.injectedHtml.length > 0 },
    { id: "balance", label: "Saldo bawaan → 0", ok: zeroBalance },
    { id: "rng", label: "RNG level " + rngLevel + (rngLevel===1?" (down)":rngLevel===3?" (menang)":" (imbang)"), ok: true },
    { id: "name", label: "Nama game", ok: !!gameTitle, value: gameTitle },
    { id: "slot", label: "Slot / game_id", ok: !!gameId, value: gameId }
  ];

  // pastikan ada index.html yang ter-inject jika ada index di root
  const indexKeys = Object.keys(out).filter((p) => /(^|\/)index\.html?$/i.test(p));
  for (const ik of indexKeys) {
    if (report.injectedHtml.includes(ik)) continue;
    const data = out[ik];
    if (!(data instanceof Uint8Array) || isBinaryLikely(data)) continue;
    let text = utf8Decode(data);
    const inj = injectSdkIntoHtml(text, eduBase, gameId);
    if (inj.injected) {
      out[ik] = utf8Encode(inj.html);
      report.injectedHtml.push(ik);
      report.patched++;
      report.files.push({ path: ik, changes: ["sdk_inject"] });
    }
  }

  return { files: out, report };
}

export { DEFAULT_EDU_BASE, buildBootstrapSnippet };
