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

function folderOf(type) {
  return ({document:"html",script:"js",stylesheet:"css",image:"images",
    media:"media",font:"fonts",xhr:"data",fetch:"data"})[type] || "other";
}

function isExcluded(url) {
  return EXCLUDE.some(r => r.test(url));
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
        map.set(u.pathname, r.localPath);
        const bare = u.pathname.split("/").pop();
        if (bare) map.set(bare, r.localPath);
      } catch {}
    }
  }
  return map;
}

function rewriteContent(text, urlMap, isHtml) {
  let out = text;
  // Replace full absolute URLs first
  for (const [from, to] of urlMap) {
    if (from.startsWith("http") && out.includes(from)) {
      out = out.split(from).join(to);
    }
  }
  // Neutralize frame-busters handled by caller for JS/HTML
  if (isHtml) {
    // Inject base tag for relative resolution if missing
    if (!/<base\s/i.test(out) && out.includes("<head>")) {
      out = out.replace("<head>", '<head>\n<base href="./">');
    }
    // Inject small protector
    const protector = `<script>(function(){try{Object.defineProperty(window,"top",{get:function(){return window}})}catch(e){}try{Object.defineProperty(window,"parent",{get:function(){return window}})}catch(e){}window.__gc_protected=1})();<\/script>`;
    if (out.includes("<head>")) out = out.replace("<head>", "<head>" + protector);
  }
  return out;
}

function smartPackage(zipFiles, manifest) {
  const urlMap = buildUrlToLocalMap(manifest);
  const result = { rewritten: 0, neutralized: 0 };
  for (const key of Object.keys(zipFiles)) {
    const isHtml = /\.html?$/i.test(key) || key === "index.html";
    const isJs = /\.js$/i.test(key);
    const isCss = /\.css$/i.test(key);
    if (!isHtml && !isJs && !isCss) continue;
    try {
      let text = new TextDecoder().decode(zipFiles[key]);
      const before = text;
      text = rewriteContent(text, urlMap, isHtml);
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health
    if (request.method === "GET" && url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "game-collector-pro", version: "4.0" });
    }

    // Serve frontend
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

          const folder = folderOf(type);
          const localPath = `${folder}/${String(manifest.length + 1).padStart(4, "0")}-${name}`;
          const r2Key = `${id}/${localPath}`;

          // Simpan ke R2 (jika ada)
          if (env.COLLECTOR_BUCKET) {
            await env.COLLECTOR_BUCKET.put(r2Key, buffer, {
              httpMetadata: { contentType: ct || "application/octet-stream" }
            });
          }

          zipFiles[localPath] = new Uint8Array(buffer);
          manifest.push({ url: u, type, status: response.status(), localPath, size: buffer.byteLength });
        } catch {}
      });

      // Navigate
      await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 40000 });
      await page.waitForTimeout(5000);

      // Coba deteksi & masuk ke iframe jika ada
      try {
        const frames = page.frames();
        for (const frame of frames) {
          if (frame === page.mainFrame()) continue;
          const frameUrl = frame.url();
          if (frameUrl && frameUrl !== "about:blank" && !frameUrl.startsWith("chrome")) {
            // Scroll di dalam frame juga
            await frame.evaluate(() => {
              window.scrollTo(0, document.body?.scrollHeight || 0);
            }).catch(() => {});
          }
        }
      } catch {}

      // Scroll halaman utama
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

      // Manifest
      const manifestData = {
        target: target.href,
        collectedAt: new Date().toISOString(),
        totalFiles: manifest.length,
        smartRewrite: smart,
        note: "Hanya resource client-side. Gunakan hanya pada game yang kamu miliki/izin.",
        resources: manifest
      };
      zipFiles["manifest.json"] = strToU8(JSON.stringify(manifestData, null, 2));

      // README
      zipFiles["README.md"] = strToU8(`# Game Resource Package (Game Collector Pro)
Target: ${target.href}
Tanggal: ${new Date().toISOString()}
Total file: ${manifest.length}
Smart rewrite: ${smart.rewritten} file · frame-buster dinetralisir: ${smart.neutralized}

## Cara pakai
1. Extract ZIP
2. Jalankan local server: npx serve .
3. Buka di browser
4. Atau buka di Workspace Game Collector Pro untuk Preview + Auto Repair + AI
`);

      await browser.close();
      browser = null;

      // Buat ZIP
      const zipData = zipSync(zipFiles, { level: 6 });
      const zipKey = `${id}/game-resources.zip`;

      if (env.COLLECTOR_BUCKET) {
        await env.COLLECTOR_BUCKET.put(zipKey, zipData, {
          httpMetadata: {
            contentType: "application/zip",
            contentDisposition: `attachment; filename="game-resources.zip"`
          }
        });
      }

      return Response.json({
        ok: true,
        id,
        files: manifest.length,
        zipSize: zipData.byteLength,
        smartRewrite: smart,
        message: `Capture berhasil (smart rewrite: ${smart.rewritten} file, frame-buster: ${smart.neutralized}). Download ZIP atau buka di Workspace.`
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
