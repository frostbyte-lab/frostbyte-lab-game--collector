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
  return ({ document: "html", script: "js", stylesheet: "css", image: "images",
    media: "media", font: "fonts", xhr: "data", fetch: "data" })[type] || "other";
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

  // Manifest
  const manifest = {
    target: TARGET_URL,
    collectedAt: new Date().toISOString(),
    totalFiles: resources.length,
    resources
  };
  zipFiles["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

  await browser.close();

  // Buat ZIP
  const zipped = zipSync(zipFiles, { level: 6 });
  if (!existsSync("output")) mkdirSync("output");
  const zipName = `game-resources-${Date.now()}.zip`;
  writeFileSync(join("output", zipName), zipped);

  console.log("Selesai!");
  console.log("Total resource:", resources.length);
  console.log("ZIP:", zipName);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
