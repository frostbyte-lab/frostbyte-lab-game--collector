import { chromium } from "playwright";
import { zipSync, strToU8 } from "fflate";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const TARGET_URL = process.env.TARGET_URL;
const WAIT_SECONDS = parseInt(process.env.WAIT_SECONDS || "8", 10);

if (!TARGET_URL) {
  console.error("ERROR: TARGET_URL tidak diisi");
  process.exit(1);
}

const TYPES = new Set([
  "document", "script", "stylesheet", "image", "media", "font", "xhr", "fetch"
]);

const EXCLUDE = [
  /google-analytics\.com/i, /googletagmanager\.com/i, /facebook\.net/i,
  /doubleclick\.net/i, /googlesyndication\.com/i, /hotjar\.com/i,
  /clarity\.ms/i, /segment\.(com|io)/i, /mixpanel\.com/i, /sentry\.io/i
];

function safe(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

function folderOf(type) {
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
  let out = text, n = 0;
  for (const re of FRAME_BUSTER_RE) {
    out = out.replace(re, (m) => { n++; return "/* GC-PRO */ false && " + m; });
  }
  return { text: out, count: n };
}

function smartPackage(zipFiles, resources) {
  const urlMap = new Map();
  for (const r of resources) {
    if (r.url && r.localPath) {
      urlMap.set(r.url, r.localPath);
      try {
        const u = new URL(r.url);
        urlMap.set(u.pathname, r.localPath);
        const bare = u.pathname.split("/").pop();
        if (bare) urlMap.set(bare, r.localPath);
      } catch {}
    }
  }
  let rewritten = 0, neutralized = 0;
  for (const key of Object.keys(zipFiles)) {
    const isHtml = /\.html?$/i.test(key) || key === "index.html";
    const isJs = /\.js$/i.test(key);
    const isCss = /\.css$/i.test(key);
    if (!isHtml && !isJs && !isCss) continue;
    try {
      let text = new TextDecoder().decode(zipFiles[key]);
      const before = text;
      for (const [from, to] of urlMap) {
        if (String(from).startsWith("http") && text.includes(from)) {
          text = text.split(from).join(to);
        }
      }
      if (isHtml || isJs) {
        const res = neutralizeFrameBusters(text);
        text = res.text;
        neutralized += res.count;
      }
      if (isHtml && !/<base\s/i.test(text) && text.includes("<head>")) {
        text = text.replace("<head>", '<head>\n<base href="./">');
      }
      if (isHtml && text.includes("<head>")) {
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
})();
<\/script>`;
        text = text.replace("<head>", "<head>" + offlineBoot);
      }
      if (text !== before) {
        zipFiles[key] = strToU8(text);
        rewritten++;
      }
    } catch {}
  }
  return { rewritten, neutralized };
}

async function main() {
  console.log("Target:", TARGET_URL);
  console.log("Wait  :", WAIT_SECONDS, "detik");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const resources = [];
  const seen = new Set();
  const zipFiles = {};

  page.on("response", async (response) => {
    try {
      const req = response.request();
      const type = req.resourceType();
      if (!TYPES.has(type)) return;

      const url = response.url();
      if (seen.has(url) || EXCLUDE.some(r => r.test(url))) return;
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      seen.add(url);

      const status = response.status();
      if (status >= 400) return;

      const buffer = await response.body();
      if (!buffer || buffer.length === 0) return;

      const ct = response.headers()["content-type"] || "";
      let name = safe(new URL(url).pathname.split("/").pop() || "index");
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
      const localPath = `${folder}/${String(resources.length + 1).padStart(4, "0")}-${name}`;

      zipFiles[localPath] = new Uint8Array(buffer);
      resources.push({ url, type, status, localPath, size: buffer.length });
    } catch {}
  });

  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(WAIT_SECONDS * 1000);

  // Scroll untuk trigger lazy load
  await page.evaluate(async () => {
    const total = Math.max(document.body?.scrollHeight || 0, 2000);
    for (let y = 0; y < total; y += 600) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 200));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(2000);

  // Ambil HTML akhir
  let html = await page.content();
  zipFiles["index.html"] = strToU8(html);

  // Smart offline packaging
  const smart = smartPackage(zipFiles, resources);

  // Manifest
  const manifest = {
    target: TARGET_URL,
    collectedAt: new Date().toISOString(),
    totalFiles: resources.length,
    smartRewrite: smart,
    resources
  };
  zipFiles["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  zipFiles["README.md"] = strToU8(`# Game Resource Package (Game Collector Pro)
Target: ${TARGET_URL}
Tanggal: ${new Date().toISOString()}
Total: ${resources.length} file
Smart rewrite: ${smart.rewritten} · frame-buster: ${smart.neutralized}

Cara pakai: extract → npx serve . → buka browser
Atau load di Workspace Game Collector Pro.
`);

  await browser.close();

  // Buat ZIP
  const zipped = zipSync(zipFiles, { level: 6 });
  if (!existsSync("output")) mkdirSync("output");
  const zipName = `game-resources-${Date.now()}.zip`;
  writeFileSync(join("output", zipName), zipped);

  console.log("Selesai!");
  console.log("Total resource:", resources.length);
  console.log("Smart rewrite:", smart.rewritten, "file · frame-buster:", smart.neutralized);
  console.log("ZIP:", zipName);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
