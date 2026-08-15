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

function folderOf(type, category) {
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

function buildKeterangan(target, manifest, smart) {
  const game = manifest.filter(r => r.category === "game");
  const api = manifest.filter(r => r.category === "api");
  const server = manifest.filter(r => r.category === "server");

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
  lines.push("index.html          # HTML utama game");
  lines.push("assets/             # Asset game (js, css, gambar, audio, font)");
  lines.push("server/");
  lines.push("  api/              # Snapshot response API (terpisah dari game)");
  lines.push("  ...               # Config / script server-related");
  lines.push("manifest.json       # Daftar resource + kategori");
  lines.push("keterangan.json     # Ringkasan machine-readable");
  lines.push("KETERANGAN.md       # File ini");
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
    hosts: [...hosts.entries()].map(([host, info]) => ({
      host,
      count: info.count,
      categories: [...info.categories],
      samples: info.samples
    })),
    apiEndpoints,
    folders: {
      game: "assets/",
      api: "server/api/",
      server: "server/",
      docs: ["KETERANGAN.md", "keterangan.json", "manifest.json", "README.md"]
    },
    note: "API/server dipisah otomatis dari asset game. Snapshot saja, bukan backend live."
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
          const folder = folderOf(type, classified.category);
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
            classifyReason: classified.reason
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

      // Smart offline packaging: path rewrite + frame-buster neutralize
      const smart = smartPackage(zipFiles, manifest);

      // Keterangan + pemisahan game vs API/server
      const ket = buildKeterangan(target.href, manifest, smart);
      const gameCount = manifest.filter(r => r.category === "game").length;
      const apiCount = manifest.filter(r => r.category === "api").length;
      const serverCount = manifest.filter(r => r.category === "server").length;

      const manifestData = {
        target: target.href,
        collectedAt: new Date().toISOString(),
        totalFiles: manifest.length,
        totals: { game: gameCount, api: apiCount, server: serverCount },
        smartRewrite: smart,
        note: "Asset game di assets/. API/server di server/ (terpisah). Lihat KETERANGAN.md.",
        resources: manifest
      };
      zipFiles["manifest.json"] = strToU8(JSON.stringify(manifestData, null, 2));
      zipFiles["keterangan.json"] = strToU8(JSON.stringify(ket.json, null, 2));
      zipFiles["KETERANGAN.md"] = strToU8(ket.md);

      zipFiles["README.md"] = strToU8(`# Game Resource Package (Game Collector Pro)
Target: ${target.href}
Tanggal: ${new Date().toISOString()}
Total: ${manifest.length} file (game: ${gameCount} · api: ${apiCount} · server: ${serverCount})
Smart rewrite: ${smart.rewritten} · frame-buster: ${smart.neutralized}

## Pemisahan otomatis
- \`assets/\` — asset game (HTML/JS/CSS/gambar/audio)
- \`server/api/\` — snapshot response API (terpisah dari game)
- \`KETERANGAN.md\` — deskripsi host, endpoint, kategori
- \`keterangan.json\` — ringkasan mesin

## Cara pakai
1. Baca **KETERANGAN.md** dulu
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
