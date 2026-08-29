/**
 * GitHub Actions collect — enhanced:
 * - status HTTP dokumen utama
 * - filter resource status >= 400
 * - strict auto-interact: Play → Spin×N → History (scripts/auto-interact.js)
 * - zip-aware detect profile (SEED_ZIP + live page)
 * - critical API tagging (spin/balance/history)
 * - scroll lazy-load, smart rewrite + frame-buster
 * - quality gate (403/empty → exit 2)
 *
 * Env:
 *   TARGET_URL (wajib)
 *   WAIT_SECONDS     default 22 (offline-first)
 *   AUTO_SPINS       default 6 (offline-first)
 *   AUTO_HISTORY     default 1
 *   SPIN_DELAY_MS    default 2200
 *   SEED_ZIP         optional path to seed ZIP
 *   AUTHORIZED_RESEARCH  1 to include authorized research metadata
 *   LICENSE_REF      URL/ID license or written permission reference
 *   CHALLENGE_MANUAL_COMPLETE  1 when user completed challenge manually
 *   MOCK_OFFLINE     1 to include mock/replay preparation metadata
 */
import { chromium } from "playwright";
import { zipSync, strToU8 } from "fflate";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { runStrictAutoInteract } from "./auto-interact.js";
import {
  detectAll,
  isCriticalApiUrl,
  classifyApiResource
} from "./zip-aware-detect.js";
import { buildApiMap } from "../src/package/api-map.js";

const TARGET_URL = process.env.TARGET_URL;
const WAIT_SECONDS = Math.max(5, parseInt(process.env.WAIT_SECONDS || "22", 10));
const AUTO_SPINS = process.env.AUTO_SPINS || "6";
const AUTO_HISTORY = process.env.AUTO_HISTORY || "1";
const SPIN_DELAY_MS = process.env.SPIN_DELAY_MS || "2200";
const AUTHORIZED_RESEARCH = process.env.AUTHORIZED_RESEARCH === "1";
const LICENSE_REF = String(process.env.LICENSE_REF || "").trim().slice(0, 500);
const CHALLENGE_MANUAL_COMPLETE = process.env.CHALLENGE_MANUAL_COMPLETE === "1";
const MOCK_OFFLINE = process.env.MOCK_OFFLINE !== "0";

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

async function captureMissingStaticAssets(page, resources, zipFiles, seen, failedRequests) {
  const candidates = [];
  const seenCandidate = new Set();
  const add = (raw) => {
    const url = String(raw || '').replace(/&amp;/gi, '&').trim();
    if (!/^https?:\/\//i.test(url) || seenCandidate.has(url)) return;
    if (!/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|mp3|ogg|wav|m4a|aac|mp4|webm|wasm|atlas)(?:[?#]|$)/i.test(url)) return;
    if (EXCLUDE.some((re) => re.test(url))) return;
    seenCandidate.add(url);
    candidates.push(url);
  };
  for (const resource of resources) {
    if (resource && resource.type === 'document' && resource.url) {
      try { add(new URL(resource.url).toString()); } catch {}
    }
  }
  try {
    const html = await page.content();
    const re = /https?:\/\/[^\s"'`<>]+/gi;
    let match;
    while ((match = re.exec(html))) add(match[0].replace(/[),;]+$/, ''));
  } catch {}
  try {
    const runtimeUrls = await page.evaluate(() => {
      const out = new Set();
      try { performance.getEntriesByType('resource').forEach((entry) => out.add(entry.name)); } catch {}
      try { document.querySelectorAll('[src],[href],[data-src],[poster]').forEach((el) => ['src', 'href', 'data-src', 'poster'].forEach((key) => { const value = el.getAttribute(key); if (value) out.add(new URL(value, location.href).href); })); } catch {}
      return [...out];
    });
    for (const url of runtimeUrls || []) add(url);
  } catch {}
  let fetched = 0;
  let reused = 0;
  let failed = 0;
  const details = [];
  for (const url of candidates) {
    const noQuery = url.split(/[?#]/, 1)[0];
    const already = resources.find((r) => String(r.url || '').split(/[?#]/, 1)[0] === noQuery);
    if (already && zipFiles[already.localPath]) { reused++; continue; }
    let name = safe(new URL(url).pathname.split('/').pop() || 'asset');
    if (!/\.[a-z0-9]{1,8}$/i.test(name)) name += '.bin';
    const localPath = `assets/images/${String(Object.keys(zipFiles).length + 1).padStart(4, '0')}-${name}`;
    try {
      const response = await page.request.get(url, {
        timeout: 30000,
        failOnStatusCode: false,
        headers: { Referer: mainDocUrl, Accept: 'image/*,audio/*,font/*,*/*;q=0.8' }
      });
      const status = response.status();
      const body = await response.body();
      if (status >= 200 && status < 300 && body && body.length > 0) {
        zipFiles[localPath] = new Uint8Array(body);
        resources.push({ url, type: 'image', status, localPath, size: body.length, contentType: response.headers()['content-type'] || 'application/octet-stream', capturedBy: 'proactive-static-asset' });
        seen.add(url);
        fetched++;
        details.push(`GET ${url.split('/').pop().slice(0, 80)} → ${localPath}`);
      } else {
        failed++;
        details.push(`FAIL ${url.split('/').pop().slice(0, 80)} HTTP ${status}`);
      }
    } catch (error) {
      failed++;
      details.push(`FAIL ${url.split('/').pop().slice(0, 80)} ${(error?.message || error).slice(0, 100)}`);
      failedRequests.push({ url: redactUrl(url), type: 'image', method: 'GET', error: String(error?.message || error).slice(0, 240), capturedBy: 'proactive-static-asset' });
    }
  }
  return { candidates: candidates.length, fetched, reused, failed, details };
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

function redactHeaders(headers = {}) {
  const blocked = /authorization|cookie|set-cookie|x-api-key|proxy-auth|signature|token/i;
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, blocked.test(key) ? '<redacted>' : String(value).slice(0, 300)]));
}
function bodyPeek(value, limit = 4096) {
  if (value == null) return null;
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  text = text.replace(/((?:authorization|cookie|token|secret|password|passwd|signature|apikey|api_key|access_key)["' ]*[:=]["' ]*)[^"'&,;\s}]+/gi, '$1<redacted>');
  return text.length > limit ? text.slice(0, limit) + '…' : text;
}

const REALTIME_MAX_EVENTS = 160;
const REALTIME_MAX_PAYLOAD = 12000;
const SECRET_KEY_RE = /authorization|cookie|set-cookie|token|secret|password|passwd|signature|api[-_]?key|access[-_]?key|private[-_]?key/i;

function redactUrl(raw) {
  try {
    const u = new URL(String(raw));
    for (const key of [...u.searchParams.keys()]) {
      if (SECRET_KEY_RE.test(key)) u.searchParams.set(key, '<redacted>');
    }
    return u.toString();
  } catch {
    return String(raw || '').replace(/((?:token|secret|password|signature|apikey|api_key)[=:])[^&\s]+/gi, '$1<redacted>');
  }
}

function redactRealtimeValue(value, depth = 0) {
  if (depth > 4) return '[nested]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    let text = value.slice(0, REALTIME_MAX_PAYLOAD);
    text = text.replace(/((?:authorization|cookie|token|secret|password|signature|apikey|api_key)[=:]\s*)[^&,;\s]+/gi, '$1<redacted>');
    if (text.length < value.length) text += '…';
    try {
      const parsed = JSON.parse(text);
      return redactRealtimeValue(parsed, depth + 1);
    } catch {
      return text;
    }
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return { binary: true, bytes: value.length };
  if (Array.isArray(value)) return value.slice(0, 60).map((item) => redactRealtimeValue(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      out[key] = SECRET_KEY_RE.test(key) ? '<redacted>' : redactRealtimeValue(item, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, REALTIME_MAX_PAYLOAD);
}

function realtimeFrame(data) {
  return redactRealtimeValue(data);
}
function topKeys(value) {
  if (!value || typeof value !== 'object') return [];
  return Array.isArray(value) ? [] : Object.keys(value).slice(0, 80);
}
function responseSchema(value, depth = 0) {
  if (depth > 2 || value == null) return value == null ? String(value) : typeof value;
  if (Array.isArray(value)) return { type: 'array', length: value.length, item: value.length ? responseSchema(value[0], depth + 1) : null };
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, responseSchema(item, depth + 1)]));
  }
  return typeof value;
}
function classifyReplayKind(url, apiKind) {
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return String(url).toLowerCase(); } })();
  if (/verifysession|session|auth|login/.test(path)) return 'session';
  if (/init|gameinfo|gamedata|config/.test(path)) return 'init';
  if (/balance|wallet|credit|cashier/.test(path)) return 'balance';
  if (/result|settle|history/.test(path)) return 'result';
  if (/spin|bet|play|round/.test(path)) return 'spin';
  return apiKind || 'other';
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
  console.log("AUTO_SPINS:", AUTO_SPINS, "AUTO_HISTORY:", AUTO_HISTORY, "SPIN_DELAY_MS:", SPIN_DELAY_MS);
  if (process.env.SEED_ZIP) console.log("SEED_ZIP:", process.env.SEED_ZIP);

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
  const criticalApis = [];
  const apiContracts = [];
  const replaySequence = [];
  const realtimeSessions = [];
  const failedRequests = [];
  const blockerSignals = [];
  let apiOrder = 0;
  let detectProfile = null;
  let mainDocStatus = 0;
  let mainDocUrl = TARGET_URL;

  page.on("requestfailed", (request) => {
    try {
      const failure = request.failure()?.errorText || "request failed";
      failedRequests.push({ url: redactUrl(request.url()), type: request.resourceType(), method: request.method(), error: failure.slice(0, 240) });
      if (failedRequests.length > 200) failedRequests.shift();
    } catch {}
  });

  page.on("websocket", (socket) => {
    const record = {
      kind: "websocket", url: redactUrl(socket.url()), protocol: "", openedAt: new Date().toISOString(),
      framesReceived: [], framesSent: [], closed: false
    };
    realtimeSessions.push(record);
    const addFrame = (list, data) => {
      if (list.length >= REALTIME_MAX_EVENTS) return;
      list.push({ at: new Date().toISOString(), data: realtimeFrame(data) });
    };
    try { socket.on("framereceived", (data) => addFrame(record.framesReceived, data)); } catch {}
    try { socket.on("framesent", (data) => addFrame(record.framesSent, data)); } catch {}
    try { socket.on("close", () => { record.closed = true; record.closedAt = new Date().toISOString(); }); } catch {}
  });

  page.on("request", (request) => {
    try {
      if (request.resourceType() !== "eventsource") return;
      realtimeSessions.push({ kind: "eventsource", url: redactUrl(request.url()), protocol: "sse", openedAt: new Date().toISOString(), framesReceived: [], framesSent: [], closed: false });
    } catch {}
  });

  page.on("response", async (response) => {
    try {
      const req = response.request();
      const type = req.resourceType();
      if (!TYPES.has(type)) return;

      const url = response.url();
      const isApi = type === "xhr" || type === "fetch";
      const duplicate = seen.has(url);
      if ((duplicate && !isApi) || EXCLUDE.some((r) => r.test(url))) return;
      if (url.startsWith("data:") || url.startsWith("blob:")) return;

      const status = response.status();
      if (status >= 400) {
        blockerSignals.push({ kind: status === 401 || status === 403 ? "auth_or_access" : "http_error", url: redactUrl(url), type, status });
        return;
      }
      if (!duplicate) seen.add(url);

      const requestHeaders = redactHeaders(req.headers());
      const requestBody = bodyPeek(req.postData());
      const parsedUrl = (() => { try { return new URL(url); } catch { return null; } })();
      const buffer = await response.body();
      if (!buffer || buffer.length === 0) return;
      if (buffer.length > 18 * 1024 * 1024) return;

      const ct = response.headers()["content-type"] || "";
      const apiKind = isApi ? classifyApiResource(url, ct) : null;
      let parsedBody = null;
      if (isApi && /json|javascript|text\//i.test(ct)) {
        try { parsedBody = JSON.parse(new TextDecoder().decode(buffer)); } catch {}
      }
      let contractForResource = null;
      if (isApi) {
        const kind = classifyReplayKind(url, apiKind);
        const contract = {
          order: ++apiOrder,
          method: req.method(),
          url: redactUrl(url),
          origin: parsedUrl?.origin || null,
          path: parsedUrl?.pathname || null,
          query: parsedUrl ? Object.fromEntries(parsedUrl.searchParams.keys().map((key) => [key, '<captured>'])) : {},
          kind,
          requestHeaders,
          requestBody,
          response: {
            status,
            headers: redactHeaders(response.headers()),
            contentType: ct,
            topKeys: topKeys(parsedBody),
            schema: responseSchema(parsedBody),
            localPath: null
          }
        };
        apiContracts.push(contract);
        contractForResource = contract;
        replaySequence.push({ order: contract.order, method: contract.method, path: contract.path, kind, requestBody });
      }
      if (duplicate) return;
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

      const critical = isCriticalApiUrl(url, detectProfile);

      let folder = folderOf(type);
      // Tag critical API responses into named files for easier analysis
      if (critical && (type === "xhr" || type === "fetch") && ct.includes("json")) {
        const tag = apiKind && apiKind !== "other" ? apiKind : "critical";
        name = `${tag}-${name}`;
        folder = "assets/data";
        criticalApis.push({ url, kind: apiKind || "critical", size: buffer.length });
        console.log("PROGRESS: critical_api", apiKind || "critical", url.slice(0, 140));
      }

      const localPath = `${folder}/${String(resources.length + 1).padStart(4, "0")}-${name}`;
      zipFiles[localPath] = new Uint8Array(buffer);
      for (const contract of apiContracts) {
        if (!contract.response.localPath && contract.url === url) contract.response.localPath = localPath;
      }
      resources.push({
        url,
        type,
        status,
        localPath,
        size: buffer.length,
        contentType: ct,
        critical: Boolean(critical),
        apiKind: apiKind || undefined,
        apiContract: contractForResource || undefined
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

  // Zip-aware + live detect profile
  console.log("PROGRESS: detect_profile");
  detectProfile = await detectAll(page);

  // Strict auto-interact: Play → Spin×N → History
  await page.waitForTimeout(1200);
  const interactResult = await runStrictAutoInteract(page, {
    autoSpins: AUTO_SPINS,
    autoHistory: AUTO_HISTORY,
    spinDelayMs: SPIN_DELAY_MS
  });

  console.log("PROGRESS: wait_resources", WAIT_SECONDS, "s");
  await page.waitForTimeout(WAIT_SECONDS * 1000);

  await scrollPage(page);
  await page.waitForTimeout(2000);

  // Proactive fallback: asset static signed yang tetap tertulis di HTML diambil
  // ulang dengan referer target, meskipun request tidak muncul sebagai response event.
  console.log("PROGRESS: proactive_static_assets");
  const proactiveAssets = await captureMissingStaticAssets(page, resources, zipFiles, seen, failedRequests);
  console.log("PROGRESS: proactive_static_assets_done", JSON.stringify(proactiveAssets));

  // HTML akhir
  console.log("PROGRESS: capture_html");
  let html = await page.content();
  zipFiles["index.html"] = strToU8(html);

  const blockedPage = isBlockedHtml(html) || mainDocStatus >= 400;
  const htmlLower = String(html || '').toLowerCase();
  const blockerReport = [];
  const addBlocker = (kind, severity, message, evidence = []) => {
    if (blockerReport.some((item) => item.kind === kind)) return;
    blockerReport.push({ kind, severity, message, evidence: evidence.slice(0, 20) });
  };
  if (mainDocStatus === 401 || mainDocStatus === 403) {
    addBlocker('auth_or_access', 'critical', 'Halaman utama membutuhkan akses resmi atau autentikasi.', [mainDocUrl]);
  }
  if (/captcha|turnstile|verify you are human|challenge-platform|hcaptcha/i.test(htmlLower)) {
    addBlocker('captcha_or_challenge', 'critical', 'Challenge/CAPTCHA terdeteksi; selesaikan secara resmi lalu capture ulang.', [mainDocUrl]);
  }
  if (/encryptedmedia|widevine|playready|fairplay|\.license|drm/i.test(htmlLower) || resources.some((r) => /drm|license|widevine|playready|fairplay/i.test(r.url))) {
    addBlocker('drm_or_license', 'critical', 'DRM atau license server terdeteksi; replikasi penuh memerlukan hak dan integrasi resmi.', resources.filter((r) => /drm|license|widevine|playready|fairplay/i.test(r.url)).map((r) => redactUrl(r.url)));
  }
  for (const item of failedRequests) {
    if (/captcha|turnstile|challenge|cloudflare/i.test(item.url + ' ' + item.error)) {
      addBlocker('captcha_or_challenge', 'critical', 'Request challenge gagal atau diblokir.', [item.url]);
    } else if (/401|403|forbidden|unauthorized|access denied/i.test(item.error)) {
      addBlocker('auth_or_access', 'high', 'Resource memerlukan autentikasi atau ditolak server.', [item.url]);
    } else {
      addBlocker('network_failures', 'medium', 'Sebagian resource gagal diambil saat capture.', failedRequests.map((x) => x.url));
    }
  }
  const realtimeSummary = realtimeSessions.map((session) => ({
    kind: session.kind || "websocket", url: session.url, openedAt: session.openedAt, closed: session.closed,
    received: session.framesReceived.length, sent: session.framesSent.length,
    framesReceived: session.framesReceived, framesSent: session.framesSent
  }));
  if (realtimeSessions.length && realtimeSessions.every((session) => session.framesReceived.length === 0 && session.framesSent.length === 0)) {
    addBlocker('realtime_no_frames', 'medium', 'WebSocket terdeteksi tetapi tidak ada frame yang berhasil direkam; mode Hybrid mungkin diperlukan.', realtimeSessions.map((session) => session.url));
  }
  if (failedRequests.length > 0 && !blockerReport.length) {
    addBlocker('network_failures', 'medium', 'Sebagian request gagal saat capture.', failedRequests.map((x) => x.url));
  }

  console.log("PROGRESS: rewrite");
  const smart = smartPackage(zipFiles, resources);
  const safeTargetUrl = redactUrl(TARGET_URL);
  const safeResources = resources.map((resource) => ({
    ...resource,
    url: redactUrl(resource.url),
    apiContract: resource.apiContract ? { ...resource.apiContract, url: redactUrl(resource.apiContract.url) } : resource.apiContract
  }));

  // api-map resmi: endpoint + snapshot + contract + replay sequence
  const apiMap = buildApiMap(safeResources, zipFiles);
  apiMap.generatedAt = new Date().toISOString();
  apiMap.criticalCount = criticalApis.length;
  apiMap.contracts = apiContracts;
  apiMap.replaySequence = replaySequence;
  apiMap.profile = {
          spinKeywords: detectProfile?.spinKeywords?.slice(0, 20),
          historyKeywords: detectProfile?.historyKeywords?.slice(0, 12),
          apiPaths: detectProfile?.apiPaths?.slice(0, 30),
          apiHosts: detectProfile?.apiHosts?.slice(0, 15)
  };
  apiMap.autoInteract = {
    autoSpins: interactResult?.autoSpins,
    autoHistory: interactResult?.autoHistory,
    spinDelayMs: interactResult?.spinDelayMs
  };
  apiMap.realtime = {
    detected: realtimeSummary.length > 0,
    sessions: realtimeSummary.map((session) => ({ kind: session.kind, url: session.url, openedAt: session.openedAt, closed: session.closed, received: session.received, sent: session.sent }))
  };
  apiMap.blockers = blockerReport;
  zipFiles["api-map.json"] = strToU8(JSON.stringify(apiMap, null, 2));
  zipFiles["realtime.json"] = strToU8(JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), sessions: realtimeSummary }, null, 2));
  zipFiles["replication-report.json"] = strToU8(JSON.stringify({
    version: 1, generatedAt: new Date().toISOString(), target: safeTargetUrl,
    status: blockerReport.some((item) => item.severity === 'critical') ? 'MANUAL_ACTION_REQUIRED' : blockerReport.length ? 'PARTIAL' : 'CAPTURED',
    blockers: blockerReport, failedRequests, proactiveStaticAssets, realtime: { sessions: realtimeSummary.length, framesReceived: realtimeSummary.reduce((n, s) => n + s.received, 0), framesSent: realtimeSummary.reduce((n, s) => n + s.sent, 0) }
  }, null, 2));

  const manifest = {
    target: safeTargetUrl,
    mainDocStatus,
    mainDocUrl: redactUrl(mainDocUrl),
    collectedAt: new Date().toISOString(),
    totalFiles: resources.length,
    criticalApis: criticalApis.length,
    smartRewrite: smart,
    authorizedResearch: {
      enabled: AUTHORIZED_RESEARCH,
      licenseRef: LICENSE_REF,
      challengeManualComplete: CHALLENGE_MANUAL_COMPLETE,
      mockOffline: MOCK_OFFLINE,
      attestedAt: AUTHORIZED_RESEARCH ? new Date().toISOString() : null
    },
    via: "github-actions",
    autoInteract: {
      autoSpins: Number(AUTO_SPINS),
      autoHistory: AUTO_HISTORY !== "0",
      spinDelayMs: Number(SPIN_DELAY_MS)
    },
    resources: safeResources,
    apiContracts,
    replaySequence,
    realtime: realtimeSummary,
    blockers: blockerReport,
    failedRequests,
    proactiveStaticAssets: proactiveAssets
  };
  zipFiles["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  zipFiles["authorized-research.json"] = strToU8(JSON.stringify({ version: 1, enabled: AUTHORIZED_RESEARCH, licenseRef: LICENSE_REF, challengeManualComplete: CHALLENGE_MANUAL_COMPLETE, mockOffline: MOCK_OFFLINE, targetHost: new URL(TARGET_URL).host, note: "Self-attestation metadata; verify license independently before distribution." }, null, 2));
  if (MOCK_OFFLINE) zipFiles["mock-offline-config.json"] = strToU8(JSON.stringify({ version: 1, enabled: true, source: "github-actions-collector", apiMap: "api-map.json", note: "Mock/replay preparation only; not a production backend." }, null, 2));
  zipFiles["README.md"] = strToU8(`# Game Resource Package (Game Collector Pro)
Target: ${safeTargetUrl}
Main document status: ${mainDocStatus}
Tanggal: ${new Date().toISOString()}
Total: ${resources.length} file
Critical API: ${criticalApis.length}
API contracts: ${apiContracts.length} · replay exchanges: ${replaySequence.length}
Smart rewrite: ${smart.rewritten} · frame-buster: ${smart.neutralized}
Proactive static assets: ${proactiveAssets.fetched} fetched · ${proactiveAssets.reused} reused · ${proactiveAssets.failed} failed
Auto spins: ${AUTO_SPINS} · history: ${AUTO_HISTORY}
Realtime sessions: ${realtimeSummary.length} · received frames: ${realtimeSummary.reduce((n, s) => n + s.received, 0)}
Blockers: ${blockerReport.length ? blockerReport.map((item) => item.kind).join(', ') : 'none'}
Via: GitHub Actions (auto-detect + strict interact)

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
          target: safeTargetUrl,
          mainDocStatus,
          mainDocUrl: redactUrl(mainDocUrl),
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
  console.log("Critical API:", criticalApis.length);
  console.log("Main doc status:", mainDocStatus);
  console.log("Smart rewrite:", smart.rewritten, "· frame-buster:", smart.neutralized);
  console.log("ZIP:", zipName);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
