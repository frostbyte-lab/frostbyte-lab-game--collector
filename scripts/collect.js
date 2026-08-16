/**
 * GitHub Actions collect — diperkuat mendekati Worker:
 * - status HTTP dokumen utama
 * - filter resource status >= 400
 * - auto-click Play/Start (main + iframe)
 * - scroll lazy-load
 * - smart rewrite + frame-buster
 * - quality gate (403/empty → exit 2)
 */
import { chromium } from "playwright";
import { zipSync, strToU8 } from "fflate";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const TARGET_URL = process.env.TARGET_URL;
const WAIT_SECONDS = Math.max(5, parseInt(process.env.WAIT_SECONDS || "12", 10));

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

const PLAY_KEYWORDS = [
  "play", "start", "mulai", "continue", "lanjut", "main", "go", "enter",
  "tap to play", "click to play", "klik untuk main", "start game", "play now",
  "mulai game", "lanjutkan", "ok", "yes", "accept", "agree", "demo"
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
  /if\s*\(\s*top\s*!=\s*self\s*\)/gi
];

function neutralizeFrameBusters(text) {
  let out = text, n = 0;
  for (const re of FRAME_BUSTER_RE) {
    out = out.replace(re, (m) => {
      n++;
      return "/* GC-PRO */ false && " + m;
    });
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
    let text = new TextDecoder().decode(zipFiles[key]);
    const nb = neutralizeFrameBusters(text);
    text = nb.text;
    neutralized += nb.count;

    for (const [from, to] of urlMap) {
      if (!from || from.length < 4) continue;
      if (text.includes(from)) {
        const parts = text.split(from);
        if (parts.length > 1) {
          text = parts.join(to);
          rewritten += parts.length - 1;
        }
      }
    }
    // protocol-relative
    text = text.replace(/(["'])\/\/([^"']+)/g, (full, q, rest) => {
      const abs = "https://" + rest;
      if (urlMap.has(abs)) {
        rewritten++;
        return q + urlMap.get(abs);
      }
      return full;
    });
    zipFiles[key] = strToU8(text);
  }
  return { rewritten, neutralized };
}

function isBlockedHtml(html) {
  const h = String(html || "");
  const hl = h.toLowerCase();
  return (
    /\b403\s*forbidden\b/i.test(h) ||
    /request forbidden by administrative rules/i.test(h) ||
    /\b401\s*unauthorized\b/i.test(h) ||
    /\baccess denied\b/i.test(h) ||
    (/\bcaptcha\b/i.test(hl) && /challenge|verify you are human|cloudflare/i.test(hl)) ||
    (/just a moment/i.test(hl) && /cloudflare/i.test(hl))
  );
}

/** Auto-click tombol Play/Start di satu frame */
async function autoClickPlayInFrame(frame) {
  try {
    await frame.evaluate((keywords) => {
      const all = document.querySelectorAll(
        "button, a, div, span, input[type=button], input[type=submit], [role=button], .btn, .button"
      );
      const scored = [];
      for (const el of all) {
        try {
          const text = (
            (el.textContent || "") +
            " " +
            (el.getAttribute("aria-label") || "") +
            " " +
            (el.id || "") +
            " " +
            (el.className || "")
          ).toLowerCase();
          if (!keywords.some((k) => text.includes(k))) continue;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          scored.push(el);
        } catch {}
      }
      for (const el of scored.slice(0, 8)) {
        try {
          el.click();
        } catch {}
      }
      return scored.length;
    }, PLAY_KEYWORDS);
  } catch {}
}

async function autoClickAllFrames(page) {
  console.log("PROGRESS: auto_click");
  await autoClickPlayInFrame(page.mainFrame());
  const frames = page.frames();
  for (const frame of frames) {
    if (frame === page.mainFrame()) continue;
    const fu = frame.url();
    if (!fu || fu === "about:blank" || fu.startsWith("chrome")) continue;
    console.log("PROGRESS: iframe", fu.slice(0, 120));
    await autoClickPlayInFrame(frame);
  }
}

async function scrollPage(page) {
  console.log("PROGRESS: scroll");
  try {
    await page.evaluate(async () => {
      const total = Math.max(
        document.body?.scrollHeight || 0,
        document.documentElement?.scrollHeight || 0,
        2000
      );
      for (let y = 0; y < total; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 200));
      }
      window.scrollTo(0, 0);
    });
  } catch {}
}

async function main() {
  console.log("PROGRESS: init");
  console.log("Target:", TARGET_URL);
  console.log("Wait seconds:", WAIT_SECONDS);

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US"
  });
  const page = await context.newPage();

  const resources = [];
  const zipFiles = {};
  const seen = new Set();
  let mainDocStatus = 0;
  let mainDocUrl = TARGET_URL;

  page.on("response", async (response) => {
    try {
      const req = response.request();
      const type = req.resourceType();
      if (!TYPES.has(type)) return;

      const url = response.url();
      if (seen.has(url) || EXCLUDE.some((r) => r.test(url))) return;
      if (url.startsWith("data:") || url.startsWith("blob:")) return;

      const status = response.status();
      if (status >= 400) return;
      seen.add(url);

      const buffer = await response.body();
      if (!buffer || buffer.length === 0) return;
      if (buffer.length > 18 * 1024 * 1024) return;

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
        else if (ct.includes("mp3") || ct.includes("audio")) name += ".mp3";
      }

      const folder = folderOf(type);
      const localPath = `${folder}/${String(resources.length + 1).padStart(4, "0")}-${name}`;
      zipFiles[localPath] = new Uint8Array(buffer);
      resources.push({
        url,
        type,
        status,
        localPath,
        size: buffer.length,
        contentType: ct
      });
    } catch {}
  });

  console.log("PROGRESS: open_url", TARGET_URL);
  try {
    const nav = await page.goto(TARGET_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    if (nav) {
      mainDocStatus = nav.status();
      mainDocUrl = nav.url() || TARGET_URL;
    }
  } catch (navErr) {
    const bare = TARGET_URL.split("#")[0];
    if (bare && bare !== TARGET_URL) {
      console.log("PROGRESS: retry_without_hash", bare);
      const nav2 = await page.goto(bare, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });
      if (nav2) {
        mainDocStatus = nav2.status();
        mainDocUrl = nav2.url() || bare;
      }
    } else {
      throw navErr;
    }
  }

  console.log("PROGRESS: page_loaded", "status=" + mainDocStatus, mainDocUrl);
  if (mainDocStatus >= 400) {
    console.warn("PROGRESS: blocked_doc HTTP", mainDocStatus);
  }

  // Interaksi: auto-click + tunggu resource
  await page.waitForTimeout(1500);
  await autoClickAllFrames(page);
  await page.waitForTimeout(1500);
  await autoClickAllFrames(page);

  console.log("PROGRESS: wait_resources", WAIT_SECONDS, "s");
  await page.waitForTimeout(WAIT_SECONDS * 1000);

  await scrollPage(page);
  await page.waitForTimeout(2000);
  // klik lagi setelah scroll (lazy UI)
  await autoClickAllFrames(page);
  await page.waitForTimeout(2000);

  // HTML akhir
  console.log("PROGRESS: capture_html");
  let html = await page.content();
  zipFiles["index.html"] = strToU8(html);

  const blockedPage = isBlockedHtml(html) || mainDocStatus >= 400;

  console.log("PROGRESS: rewrite");
  const smart = smartPackage(zipFiles, resources);

  const manifest = {
    target: TARGET_URL,
    mainDocStatus,
    mainDocUrl,
    collectedAt: new Date().toISOString(),
    totalFiles: resources.length,
    smartRewrite: smart,
    via: "github-actions",
    resources
  };
  zipFiles["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  zipFiles["README.md"] = strToU8(`# Game Resource Package (Game Collector Pro)
Target: ${TARGET_URL}
Main document status: ${mainDocStatus}
Tanggal: ${new Date().toISOString()}
Total: ${resources.length} file
Smart rewrite: ${smart.rewritten} · frame-buster: ${smart.neutralized}
Via: GitHub Actions (enhanced)

Cara pakai: extract → npx serve . → buka browser
Atau load di Workspace Game Collector Pro.
`);

  await browser.close();

  if (!existsSync("output")) mkdirSync("output");

  // Quality gate
  if (blockedPage || resources.length === 0) {
    const reason = blockedPage ? "TARGET_BLOCKED" : "EMPTY_PACKAGE";
    const message = blockedPage
      ? `Situs memblokir akses (HTTP ${mainDocStatus || "?"} / challenge). Asset usable tidak tersedia.`
      : "0 resource tertangkap. Paket tidak usable.";
    zipFiles["COLLECT_FAILED.json"] = strToU8(
      JSON.stringify(
        {
          ok: false,
          reason,
          message,
          target: TARGET_URL,
          mainDocStatus,
          mainDocUrl,
          totalFiles: resources.length,
          at: new Date().toISOString()
        },
        null,
        2
      )
    );
    const failName = `game-resources-FAILED-${Date.now()}.zip`;
    writeFileSync(join("output", failName), zipSync(zipFiles, { level: 6 }));
    console.error("PROGRESS: failed", reason);
    console.error(message);
    console.error("ZIP (gagal):", failName);
    process.exit(2);
  }

  const zipped = zipSync(zipFiles, { level: 6 });
  const zipName = `game-resources-${Date.now()}.zip`;
  writeFileSync(join("output", zipName), zipped);

  console.log("PROGRESS: zip_done");
  console.log("Selesai!");
  console.log("Total resource:", resources.length);
  console.log("Main doc status:", mainDocStatus);
  console.log("Smart rewrite:", smart.rewritten, "· frame-buster:", smart.neutralized);
  console.log("ZIP:", zipName);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
