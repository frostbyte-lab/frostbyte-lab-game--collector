/**
 * ANALISA GAME → Offline & Sandbox (spec-aligned)
 * ANALYZE ≠ DELETE. Backup → change-plan → convert → validate → sandbox.
 */
(function (global) {
  "use strict";

  const EXTERNAL_URL_RE = /https?:\/\/[^\s"'`<>)\\]+/gi;
  const FETCH_RE = /\b(?:fetch|axios|XMLHttpRequest|\.ajax)\s*\(/gi;
  const WS_RE = /\b(?:WebSocket|new\s+WebSocket)\s*\(/gi;
  const REDIRECT_RE =
    /(?:window\.)?location\.(?:href|replace|assign)\s*=|location\.replace\s*\(/gi;
  const IMPORT_EXT_RE =
    /(?:import\s*\(|import\s+.*from\s+|require\s*\()\s*['"]https?:\/\//gi;
  const SCRIPT_SRC_EXT_RE = /<script[^>]+src\s*=\s*["']https?:\/\//gi;
  const LINK_HREF_EXT_RE = /<link[^>]+href\s*=\s*["']https?:\/\//gi;
  const API_PATH_RE =
    /\/api\/[a-z0-9_\-./]+|\/game\/(?:init|session|balance|bet|spin|result|history)|gamewallet|verifysession|game-api|game-proxy|\/spin\b|\/bet\b/gi;
  const TRACKING_RE =
    /google-analytics|googletagmanager|gtag\s*\(|facebook\.net|hotjar|clarity\.ms|mixpanel|segment\.(?:com|io)|telemetry|analytics\.|tracking/gi;

  const CODE_EXT = /\.(js|mjs|cjs|ts|jsx|tsx|html?|css|json|map)$/i;
  const ASSET_EXT = /\.(png|jpe?g|webp|gif|svg|mp3|ogg|wav|woff2?|ttf|otf|atlas)$/i;

  const SERVER_KIND_RE = {
    session: /session|verifysession|auth|token|login/i,
    config: /config|gameinfo|gamedata|initgame|launch/i,
    resource: /resource|assets?\/|cdn|static/i,
    authentication: /auth|oauth|signin|login/i,
    state: /state|gamestate|round/i,
    balance: /balance|wallet|credit|cashier/i,
    gameData: /symbols?|paytable|reel|feature/i,
    result: /result|outcome|settle|winamount/i,
    other: /api|fetch|xhr|websocket/i
  };

  function isTextPath(path) {
    return CODE_EXT.test(path) || /\.(xml|svg|txt|md)$/i.test(path);
  }

  function baseName(path) {
    const p = String(path || "");
    const i = p.lastIndexOf("/");
    return i >= 0 ? p.slice(i + 1) : p;
  }

  function isProtectedPath(path) {
    const b = baseName(path).toLowerCase();
    if (b === "index.html" || b === "index.htm") return "launcher";
    if (b === "manifest.json") return "manifest";
    if (b === "api-map.json" || b === "keterangan.json" || b === "kelengkapan.json") return "map";
    return null;
  }

  function detectServerKinds(text, path) {
    const s = (text || "") + " " + (path || "");
    const kinds = [];
    for (const [k, re] of Object.entries(SERVER_KIND_RE)) {
      if (re.test(s)) kinds.push(k);
    }
    return Array.from(new Set(kinds));
  }

  function classifyPath(path, text) {
    const p = String(path || "");
    const pl = p.toLowerCase();
    const t = String(text || "");
    const reasons = [];
    const refs = [];
    let category = "SAFE";
    let action = "KEEP";
    let serverDep = false;
    let serverKinds = [];

    const protectedKind = isProtectedPath(p);
    if (protectedKind === "launcher") {
      action = "KEEP";
      category = "SAFE";
      reasons.push("Launcher/entry (index.html) — default KEEP");
    }
    if (protectedKind === "manifest") {
      action = "KEEP";
      category = "SAFE";
      reasons.push("manifest.json — default KEEP (PWA/launcher)");
    }
    if (protectedKind === "map") {
      action = "REVIEW";
      category = "REVIEW";
      reasons.push("Map/metadata — analisa dulu, jangan hapus otomatis");
    }

    if (ASSET_EXT.test(pl) && !CODE_EXT.test(pl)) {
      return {
        category: "SAFE",
        action: "KEEP",
        reasons: ["Asset lokal"],
        refs: [],
        serverDep: false,
        serverKinds: []
      };
    }

    if (/^BACKUP\//i.test(p)) {
      return {
        category: "SAFE",
        action: "KEEP",
        reasons: ["Backup internal"],
        refs: [],
        serverDep: false,
        serverKinds: []
      };
    }

    let m;
    EXTERNAL_URL_RE.lastIndex = 0;
    while ((m = EXTERNAL_URL_RE.exec(t)) !== null) {
      const u = m[0].slice(0, 180);
      refs.push(u);
      if (TRACKING_RE.test(u)) {
        category = "TRACKING";
        reasons.push("URL tracking/analytics");
      } else if (API_PATH_RE.test(u) || /\/api\//i.test(u)) {
        category = "API";
        serverDep = true;
        reasons.push("URL API/backend");
      } else {
        if (category === "SAFE" || category === "REVIEW") category = "EXTERNAL";
        reasons.push("URL eksternal");
      }
    }

    if (FETCH_RE.test(t) || WS_RE.test(t)) {
      serverDep = true;
      if (category === "SAFE" || category === "EXTERNAL" || category === "REVIEW") category = "API";
      reasons.push(WS_RE.test(t) ? "WebSocket" : "fetch/XHR");
    }
    if (API_PATH_RE.test(t)) {
      category = "API";
      serverDep = true;
      reasons.push("Path API game");
    }
    if (TRACKING_RE.test(t) && category !== "API") {
      category = "TRACKING";
      reasons.push("Telemetry/analytics");
    }
    if (REDIRECT_RE.test(t) || SCRIPT_SRC_EXT_RE.test(t) || LINK_HREF_EXT_RE.test(t) || IMPORT_EXT_RE.test(t)) {
      if (category === "SAFE" || category === "REVIEW") category = "REDIRECT";
      reasons.push("Redirect / script/CDN eksternal");
    }

    if (
      (category === "SAFE" || category === "REVIEW") &&
      /(?:api|analytics|telemetry|tracker)[-_.]/i.test(baseName(p)) &&
      !protectedKind
    ) {
      category = "REVIEW";
      action = "REVIEW";
      reasons.push("Nama file mencurigakan — perlu review manual");
    }

    if (serverDep) {
      serverKinds = detectServerKinds(t, p);
      if (category === "SAFE") category = "SERVER_DEPENDENCY";
    }

    if (protectedKind === "launcher" || protectedKind === "manifest") {
      action = category === "SAFE" ? "KEEP" : "REVIEW";
      if (category === "TRACKING") category = "REVIEW";
    } else if (protectedKind === "map") {
      action = "REVIEW";
    } else if (category === "SAFE") {
      action = "KEEP";
    } else if (category === "TRACKING") {
      action = "REMOVE";
    } else if (category === "API" || category === "SERVER_DEPENDENCY") {
      action = "REPLACE";
    } else if (category === "EXTERNAL" || category === "REDIRECT" || category === "REVIEW") {
      action = "REVIEW";
    }

    return {
      category,
      action,
      reasons: Array.from(new Set(reasons)).slice(0, 10),
      refs: Array.from(new Set(refs)).slice(0, 12),
      serverDep,
      serverKinds
    };
  }

  async function analyzeZip(zip, opts) {
    const onProgress = (opts && opts.onProgress) || function () {};
    const files = [];
    const paths = Object.keys(zip.files).filter(function (p) { return !zip.files[p].dir; });
    const total = paths.length || 1;
    var i = 0;

    for (const path of paths) {
      i++;
      if (i % 4 === 0 || i === total) {
        onProgress(Math.round((i / total) * 88), "Scan " + path.slice(0, 64));
      }
      var text = "";
      if (isTextPath(path)) {
        try {
          text = await zip.files[path].async("string");
          if (text.length > 900000) text = text.slice(0, 900000);
        } catch (e) {
          text = "";
        }
      }
      const c = classifyPath(path, text);
      files.push({
        path: path,
        size: text ? text.length : 0,
        category: c.category,
        action: c.action,
        reasons: c.reasons,
        refs: c.refs,
        serverDep: c.serverDep,
        serverKinds: c.serverKinds || [],
        userAction: c.action
      });
    }

    onProgress(92, "Menyusun laporan...");

    const summary = {
      total: files.length,
      safe: files.filter(function (f) { return f.category === "SAFE"; }).length,
      external: files.filter(function (f) { return f.category === "EXTERNAL"; }).length,
      api: files.filter(function (f) { return f.category === "API" || f.category === "BACKEND_API"; }).length,
      tracking: files.filter(function (f) { return f.category === "TRACKING"; }).length,
      domain: files.filter(function (f) { return f.category === "REDIRECT" || f.category === "DOMAIN_REDIRECT"; }).length,
      serverDependency: files.filter(function (f) { return f.serverDep; }).length,
      removeCandidates: files.filter(function (f) { return f.action === "REMOVE"; }).length,
      replaceCandidates: files.filter(function (f) { return f.action === "REPLACE"; }).length,
      reviewCandidates: files.filter(function (f) { return f.action === "REVIEW"; }).length,
      keep: files.filter(function (f) { return f.action === "KEEP"; }).length
    };

    const serverBreakdown = {
      session: 0, config: 0, resource: 0, authentication: 0,
      state: 0, balance: 0, gameData: 0, result: 0, other: 0
    };
    files.forEach(function (f) {
      (f.serverKinds || []).forEach(function (k) {
        if (serverBreakdown[k] != null) serverBreakdown[k]++;
        else serverBreakdown.other++;
      });
    });

    const changePlan = buildChangePlan(files);
    onProgress(100, "Selesai (belum mengubah file)");
    return {
      mode: "offline-sandbox",
      createdAt: new Date().toISOString(),
      summary: summary,
      serverBreakdown: serverBreakdown,
      changePlan: changePlan,
      files: files,
      offlineReady: null,
      note: "ANALYZE ≠ DELETE — belum ada file yang diubah."
    };
  }

  function buildChangePlan(files) {
    const plan = {
      keep: [], review: [], replace: [], remove: [], mock: [],
      generated: [
        "BACKUP/offline-conversion/analysis-report.json",
        "BACKUP/offline-conversion/change-plan.json",
        "BACKUP/offline-conversion/manifest.json",
        "sandbox/mock-api.js"
      ]
    };
    // Terima array files ATAU objek report { files: [...] }
    var list = Array.isArray(files) ? files : (files && Array.isArray(files.files) ? files.files : []);
    list.forEach(function (f) {
      const act = f.userAction || f.action;
      if (act === "KEEP") plan.keep.push(f.path);
      else if (act === "REVIEW") plan.review.push(f.path);
      else if (act === "REPLACE") { plan.replace.push(f.path); plan.mock.push(f.path); }
      else if (act === "REMOVE") plan.remove.push(f.path);
    });
    return plan;
  }

  function sandboxMockApiSource() {
    return "/* GC Sandbox Mock API + network shim (Sprint 1) */\n" +
      "(function (g) {\n" +
      "  if (g.__GC_SHIM_INSTALLED__) return;\n" +
      "  g.__GC_SHIM_INSTALLED__ = true;\n" +
      "  var balance = typeof g.__GC_MOCK_BALANCE__ === 'number' ? g.__GC_MOCK_BALANCE__ : 100000;\n" +
      "  var session = { id: 'sandbox-' + Date.now(), ok: true };\n" +
      "  function wrap(data) {\n" +
      "    return { ok: true, mock: true, __gcMock: true, err: null, error: 0, code: 0, status: 'ok', dt: data, data: data, balance: data.balance != null ? data.balance : balance, bl: data.balance != null ? data.balance : balance };\n" +
      "  }\n" +
      "  function payload(url) {\n" +
      "    var s = String(url || '').toLowerCase();\n" +
      "    if (/spin|bet|play/.test(s)) {\n" +
      "      var win = Math.random() > 0.7 ? Math.floor(Math.random() * 500) : 0;\n" +
      "      balance += win;\n" +
      "      var symbols = [[1,2,3],[4,5,6],[7,8,9]];\n" +
      "      return Object.assign(wrap({ win: win, winAmount: win, balance: balance, symbols: symbols, reels: symbols, rl: symbols, si: session.id, roundId: 'r-' + Date.now() }), { win: win, symbols: symbols, reels: symbols });\n" +
      "    }\n" +
      "    if (/balance|wallet|credit/.test(s)) return wrap({ balance: balance, credit: balance, currency: 'IDR' });\n" +
      "    if (/session|auth|token|login|init|launch|verifysession/.test(s)) return Object.assign(wrap({ session: session, token: 'sandbox-token', balance: balance, playerId: 'p-sandbox' }), { session: session });\n" +
      "    if (/history|result/.test(s)) return wrap({ items: [], list: [], balance: balance });\n" +
      "    return wrap({ balance: balance, session: session });\n" +
      "  }\n" +
      "  function jsonResp(data) {\n" +
      "    var body = JSON.stringify(data);\n" +
      "    if (typeof Response !== 'undefined') {\n" +
      "      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json', 'X-GC-Mock': '1' } }));\n" +
      "    }\n" +
      "    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(data); }, text: function () { return Promise.resolve(body); } });\n" +
      "  }\n" +
      "  g.__GC_OFFLINE__ = true;\n" +
      "  g.__GC_MOCK_BALANCE__ = balance;\n" +
      "  g.__GC_SANDBOX_API__ = {\n" +
      "    init: function () { return jsonResp({ ok: true, session: session, balance: balance }); },\n" +
      "    session: function () { return jsonResp(session); },\n" +
      "    balance: function () { return jsonResp({ balance: balance }); },\n" +
      "    bet: function (n) { balance = Math.max(0, balance - (Number(n) || 0)); return jsonResp({ balance: balance }); },\n" +
      "    spin: function () { return jsonResp(payload('/spin')); },\n" +
      "    result: function () { return jsonResp({ balance: balance }); },\n" +
      "    history: function () { return jsonResp({ items: [] }); }\n" +
      "  };\n" +
      "  function isApi(u) {\n" +
      "    return /\\/api\\/|\\/game\\/(init|session|balance|bet|spin|result)|gamewallet|verifysession|\\/spin\\b|\\/bet\\b|\\/balance\\b/i.test(String(u || ''));\n" +
      "  }\n" +
      "  if (g.fetch) {\n" +
      "    var of = g.fetch;\n" +
      "    g.fetch = function (input, init) {\n" +
      "      var u = (input && input.url) || input;\n" +
      "      if (isApi(u)) return jsonResp(payload(u));\n" +
      "      return of.apply(this, arguments);\n" +
      "    };\n" +
      "  }\n" +
      "  try {\n" +
      "    var XO = g.XMLHttpRequest;\n" +
      "    if (XO) {\n" +
      "      var oOpen = XO.prototype.open, oSend = XO.prototype.send;\n" +
      "      XO.prototype.open = function (m, u) {\n" +
      "        this.__gc_api = isApi(u);\n" +
      "        this.__gc_url = u;\n" +
      "        if (this.__gc_api) return oOpen.call(this, m, 'about:blank');\n" +
      "        return oOpen.apply(this, arguments);\n" +
      "      };\n" +
      "      XO.prototype.send = function () {\n" +
      "        var self = this;\n" +
      "        if (self.__gc_api) {\n" +
      "          var text = JSON.stringify(payload(self.__gc_url));\n" +
      "          setTimeout(function () {\n" +
      "            try {\n" +
      "              Object.defineProperty(self, 'status', { value: 200 });\n" +
      "              Object.defineProperty(self, 'readyState', { value: 4 });\n" +
      "              Object.defineProperty(self, 'responseText', { value: text });\n" +
      "              Object.defineProperty(self, 'response', { value: text });\n" +
      "              if (self.onreadystatechange) self.onreadystatechange();\n" +
      "              if (self.onload) self.onload();\n" +
      "            } catch (e) {}\n" +
      "          }, 8);\n" +
      "          return;\n" +
      "        }\n" +
      "        return oSend.apply(self, arguments);\n" +
      "      };\n" +
      "    }\n" +
      "  } catch (e) {}\n" +
      "  console.info('[GC Sandbox] mock API + network shim siap');\n" +
      "})(typeof window !== 'undefined' ? window : globalThis);\n";
  }

  async function applyConversion(zip, report) {
    report.changePlan = buildChangePlan(report.files);
    const changed = [];
    const removed = [];
    const replaced = [];
    const kept = [];
    const backup = {
      mode: "offline-sandbox",
      createdAt: new Date().toISOString(),
      filesChanged: [],
      filesRemoved: [],
      filesReplaced: [],
      filesKept: []
    };

    zip.file("BACKUP/offline-conversion/change-plan.json", JSON.stringify(report.changePlan, null, 2));
    zip.file("BACKUP/offline-conversion/analysis-report.json", JSON.stringify({
      createdAt: report.createdAt,
      summary: report.summary,
      serverBreakdown: report.serverBreakdown,
      files: report.files.map(function (x) {
        return {
          path: x.path,
          category: x.category,
          action: x.userAction || x.action,
          reasons: x.reasons,
          serverKinds: x.serverKinds
        };
      })
    }, null, 2));

    for (const f of report.files) {
      const act = f.userAction || f.action;
      if (act === "KEEP" || f.category === "SAFE") {
        kept.push(f.path);
        continue;
      }
      if (!zip.files[f.path] || zip.files[f.path].dir) continue;
      if (isProtectedPath(f.path) === "launcher") {
        kept.push(f.path);
        continue;
      }
      if (isProtectedPath(f.path) === "manifest" && act === "REMOVE") {
        kept.push(f.path);
        continue;
      }

      if (act === "REMOVE" && f.category === "TRACKING" && /\.(js|mjs)$/i.test(f.path)) {
        const prev = await zip.files[f.path].async("string").catch(function () { return ""; });
        zip.file("BACKUP/offline-conversion/original/" + f.path.replace(/\//g, "__"), prev);
        zip.file(f.path, "/* GC-OFFLINE: tracking disabled */\nconsole.debug('[offline] tracking stub');\n");
        removed.push(f.path);
        backup.filesRemoved.push(f.path);
        changed.push(f.path);
        continue;
      }

      if (act === "REPLACE" && /\.(js|mjs|json)$/i.test(f.path)) {
        const prev = await zip.files[f.path].async("string").catch(function () { return ""; });
        zip.file("BACKUP/offline-conversion/original/" + f.path.replace(/\//g, "__"), prev);
        if (/\.json$/i.test(f.path) || /\.json$/i.test(f.path)) {
          var data = {};
          try { data = JSON.parse(prev); } catch (e) { data = { raw: true }; }
          zip.file(f.path, JSON.stringify({
            __gcOfflineMock: true,
            note: "Sandbox replacement — original in BACKUP",
            session: { id: "sandbox-local", ok: true },
            balance: 100000,
            originalKeys: Object.keys(data).slice(0, 40)
          }, null, 2));
        } else {
          var next = "/* GC-OFFLINE MOCK */\ntry{if(typeof window!=='undefined'){window.__GC_OFFLINE__=true;window.__GC_MOCK_BALANCE__=window.__GC_MOCK_BALANCE__||100000;}}catch(e){}\n" +
            prev.replace(TRACKING_RE, "/*gc-track*/");
          zip.file(f.path, next);
        }
        replaced.push(f.path);
        backup.filesReplaced.push(f.path);
        changed.push(f.path);
        continue;
      }

      if (act === "REVIEW" && /\.(html?)$/i.test(f.path) && isProtectedPath(f.path) !== "launcher") {
        const prev = await zip.files[f.path].async("string").catch(function () { return ""; });
        zip.file("BACKUP/offline-conversion/original/" + f.path.replace(/\//g, "__"), prev);
        var html2 = prev
          .replace(/<script[^>]+src\s*=\s*["']https?:\/\/[^"']+["'][^>]*>\s*<\/script>/gi, "<!-- gc: external script removed -->")
          .replace(/<link[^>]+href\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi, "<!-- gc: external link removed -->");
        zip.file(f.path, html2);
        changed.push(f.path);
        backup.filesChanged.push(f.path);
      }
    }

    zip.file("sandbox/mock-api.js", sandboxMockApiSource());
    backup.filesChanged.push("sandbox/mock-api.js");

    // api-map.json dari file API/EXTERNAL (process 2 — map API → mock)
    try {
      var apiEps = [];
      (report.files || []).forEach(function (f) {
        if (!f || (f.category !== "API" && f.category !== "EXTERNAL" && !f.serverDep)) return;
        var path = "/" + String(f.path || "").replace(/^\/+/, "");
        apiEps.push({
          url: (f.refs && f.refs[0]) || path,
          path: path,
          pathLower: path.toLowerCase(),
          kind: (f.serverKinds && f.serverKinds[0]) || "api",
          localPath: f.path,
          hasSnapshot: false,
          snapshot: null,
          mockTemplate: { ok: true, mock: true, balance: 100000 }
        });
      });
      zip.file("api-map.json", JSON.stringify({
        version: 1,
        generatedAt: new Date().toISOString(),
        from: "offline-analyze",
        totals: { endpoints: apiEps.length, withSnapshot: 0 },
        endpoints: apiEps.slice(0, 120),
        routes: apiEps.slice(0, 120).map(function (e, i) {
          return { i: i, path: e.pathLower, kind: e.kind, hasSnapshot: false };
        })
      }, null, 2));
      backup.filesChanged.push("api-map.json");
    } catch (eMap) { /* ignore */ }

    var indexPath = Object.keys(zip.files).find(function (p) {
      return !zip.files[p].dir && /(^|\/)index\.html?$/i.test(p);
    });
    if (indexPath) {
      var html = await zip.files[indexPath].async("string").catch(function () { return ""; });
      if (html && !/sandbox\/mock-api\.js/i.test(html)) {
        zip.file("BACKUP/offline-conversion/original/" + indexPath.replace(/\//g, "__"), html);
        var tag = '<script src="./sandbox/mock-api.js"><\/script>\n';
        if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, tag + "</head>");
        else if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, tag + "</body>");
        else html = tag + html;
        zip.file(indexPath, html);
        changed.push(indexPath);
        backup.filesChanged.push(indexPath);
      }
    }

    backup.filesKept = kept.slice(0, 800);
    zip.file("BACKUP/offline-conversion/manifest.json", JSON.stringify(backup, null, 2));

    var validation = await quickOfflineCheck(zip);
    report.offlineReady = validation.status;
    report.validation = validation;
    return {
      backup: backup,
      changed: changed,
      removed: removed,
      replaced: replaced,
      kept: kept,
      validation: validation,
      changePlan: report.changePlan
    };
  }

  async function quickOfflineCheck(zip) {
    const checks = {
      launcher: false, engineHint: false, assets: false, config: false,
      scripts: false, sandboxService: false,
      externalApi: true, externalDomain: true, websocket: true, redirect: true
    };
    const remaining = [];
    const paths = Object.keys(zip.files).filter(function (p) { return !zip.files[p].dir; });

    checks.launcher = paths.some(function (p) { return /(^|\/)index\.html?$/i.test(p); });
    checks.assets = paths.some(function (p) { return ASSET_EXT.test(p) || /assets\//i.test(p); });
    checks.config = paths.some(function (p) { return /config|paytable|symbol/i.test(p); });
    checks.scripts = paths.some(function (p) { return /\.(js|mjs)$/i.test(p); });
    checks.engineHint = paths.some(function (p) { return /spin|reel|engine|game\.js|main\.js/i.test(p); });
    checks.sandboxService = paths.some(function (p) { return /sandbox\/mock-api\.js/i.test(p); });

    for (const path of paths) {
      if (!isTextPath(path) || /^BACKUP\//i.test(path)) continue;
      var t = "";
      try {
        t = await zip.files[path].async("string");
        if (t.length > 400000) t = t.slice(0, 400000);
      } catch (e) { continue; }
      if (WS_RE.test(t)) {
        checks.websocket = false;
        remaining.push({ path: path, issue: "WebSocket" });
      }
      if (API_PATH_RE.test(t) && FETCH_RE.test(t)) {
        checks.externalApi = false;
        remaining.push({ path: path, issue: "API fetch" });
      }
      var urls = t.match(EXTERNAL_URL_RE) || [];
      for (var ui = 0; ui < urls.length; ui++) {
        var u = urls[ui];
        if (TRACKING_RE.test(u)) continue;
        if (/https?:\/\//i.test(u) && !/localhost|127\.0\.0\.1/i.test(u)) {
          checks.externalDomain = false;
          remaining.push({ path: path, issue: "external URL" });
          break;
        }
      }
    }

    var hardFail = !checks.launcher || !checks.scripts || remaining.length > 12;
    var partial = remaining.length > 0 || !checks.sandboxService;
    var status = "OFFLINE READY";
    if (hardFail) status = "OFFLINE NOT READY";
    else if (partial) status = "OFFLINE PARTIAL";

    return {
      ready: status === "OFFLINE READY",
      status: status,
      checks: checks,
      remaining: remaining.slice(0, 40),
      remainingCount: remaining.length
    };
  }


  /** Peta dependency internal file (mirip madge, tanpa CLI) */
  function buildInternalDepMap(pathToText) {
    var edges = [];
    var nodes = Object.keys(pathToText || {});
    var byBase = {};
    nodes.forEach(function (p) {
      var b = baseName(p);
      if (!byBase[b]) byBase[b] = [];
      byBase[b].push(p);
    });
    var importRe = /(?:import\s*(?:\([^)]*\)|[^'"\n]+from\s*)|require\s*\(|importScripts\s*\()\s*['"]([^'"]+)['"]/gi;
    var srcRe = /(?:src|href)=["']([^"']+)["']/gi;
    nodes.forEach(function (from) {
      var text = pathToText[from];
      if (!text || typeof text !== 'string') return;
      var seen = {};
      function addRef(raw) {
        if (!raw || raw.length > 240) return;
        if (/^(data:|blob:|https?:|\/\/|#|javascript:)/i.test(raw)) return;
        var clean = raw.split('?')[0].split('#')[0];
        var bare = baseName(clean);
        var targets = [];
        if (pathToText[clean]) targets.push(clean);
        if (pathToText['./' + clean]) targets.push('./' + clean);
        // resolve relative to from dir
        var dir = from.includes('/') ? from.replace(/\/[^/]+$/, '/') : '';
        var joined = (dir + clean).replace(/\/\.\//g, '/');
        if (pathToText[joined]) targets.push(joined);
        if (byBase[bare]) targets = targets.concat(byBase[bare]);
        targets.forEach(function (to) {
          if (to === from) return;
          var key = from + '->' + to;
          if (seen[key]) return;
          seen[key] = 1;
          edges.push({ from: from, to: to, via: raw.slice(0, 120) });
        });
      }
      var m;
      importRe.lastIndex = 0;
      while ((m = importRe.exec(text))) addRef(m[1]);
      srcRe.lastIndex = 0;
      while ((m = srcRe.exec(text))) addRef(m[1]);
    });
    var inbound = {};
    edges.forEach(function (e) {
      inbound[e.to] = (inbound[e.to] || 0) + 1;
    });
    return {
      generatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      edges: edges.slice(0, 2000),
      mostReferenced: Object.keys(inbound)
        .map(function (p) { return { path: p, count: inbound[p] }; })
        .sort(function (a, b) { return b.count - a.count; })
        .slice(0, 40)
    };
  }

  global.GCOfflineAnalyze = {
    analyzeZip: analyzeZip,
    applyConversion: applyConversion,
    quickOfflineCheck: quickOfflineCheck,
    classifyPath: classifyPath,
    buildChangePlan: buildChangePlan,
    buildInternalDepMap: buildInternalDepMap
  };
})(typeof window !== "undefined" ? window : globalThis);
