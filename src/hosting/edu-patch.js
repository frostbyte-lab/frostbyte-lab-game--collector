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
 * Rewrite string content to point API traffic at EDU base.
 * @returns {{ text: string, changes: string[] }}
 */
export function rewriteApiContent(text, eduBase, gameId) {
  const base = String(eduBase || DEFAULT_EDU_BASE).replace(/\/$/, "");
  const changes = [];
  let out = text;

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

  // 4) known provider hosts → EDU (only when followed by /api or end)
  out = out.replace(PROVIDER_HOST_RE, (host) => {
    // jangan ganti asset CDN murni tanpa /api di konteks — tetap ganti host provider game API
    changes.push("provider_host");
    return base;
  });

  // 5) relative "/api/..." stays (same-origin on EDU Pages) — OK
  // 6) inject markers for game id in common config objects
  if (gameId) {
    const gid = String(gameId);
    // "game_id": "something" or gameId: '...'
    const gidRe =
      /(["']?(?:game_id|gameId|gameID|game_slug)["']?\s*[:=]\s*)(["'`])[^"'`]{0,64}\2/g;
    let gidHits = 0;
    out = out.replace(gidRe, (full, prefix, quote) => {
      gidHits++;
      return prefix + quote + gid + quote;
    });
    if (gidHits) changes.push(`game_id_x${gidHits}`);
  }

  // dedupe change labels
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

/**
 * Patch seluruh map path → Uint8Array.
 * @param {Record<string, Uint8Array>} files
 * @param {{ eduBase?: string, gameId?: string }} opts
 */
export function patchFilesForEdu(files, opts = {}) {
  const eduBase = (opts.eduBase || DEFAULT_EDU_BASE).replace(/\/$/, "");
  const gameId = opts.gameId || "game-1";
  const report = {
    scanned: 0,
    patched: 0,
    injectedHtml: [],
    files: [],
    eduBase,
    gameId
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

    if (/\.html?$/i.test(path)) {
      const inj = injectSdkIntoHtml(text, eduBase, gameId);
      text = inj.html;
      if (inj.injected) {
        fileChanges.push("sdk_inject");
        report.injectedHtml.push(path);
      }
    }

    if (fileChanges.length) {
      out[path] = utf8Encode(text);
      report.patched++;
      report.files.push({ path, changes: fileChanges });
    }
  }

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
