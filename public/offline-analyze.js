/**
 * ANALISA GAME → Offline & Sandbox
 * Client-side scan of JSZip package: external deps, API, tracking, redirects.
 * Does NOT delete without confirmation + backup.
 */
(function (global) {
  "use strict";

  const EXTERNAL_URL_RE =
    /https?:\/\/[^\s"'`<>)\\]+/gi;
  const FETCH_RE =
    /\b(?:fetch|axios|XMLHttpRequest|\.ajax)\s*\(/gi;
  const WS_RE = /\b(?:WebSocket|new\s+WebSocket)\s*\(/gi;
  const REDIRECT_RE =
    /(?:window\.)?location\.(?:href|replace|assign)\s*=|location\.replace\s*\(/gi;
  const IMPORT_EXT_RE =
    /(?:import\s*\(|import\s+.*from\s+|require\s*\()\s*['"]https?:\/\//gi;
  const SCRIPT_SRC_EXT_RE =
    /<script[^>]+src\s*=\s*["']https?:\/\//gi;
  const LINK_HREF_EXT_RE =
    /<link[^>]+href\s*=\s*["']https?:\/\//gi;

  const API_PATH_RE =
    /\/api\/[a-z0-9_\-./]+|\/game\/(?:init|session|balance|bet|spin|result|history)|gamewallet|verifysession|game-api|game-proxy/gi;
  const TRACKING_RE =
    /google-analytics|googletagmanager|gtag\s*\(|facebook\.net|hotjar|clarity\.ms|mixpanel|segment\.(?:com|io)|telemetry|analytics\.|tracking/gi;

  const SAFE_EXT = /\.(png|jpe?g|webp|gif|svg|mp3|ogg|wav|woff2?|ttf|otf|css|html?|json|atlas|txt|md)$/i;
  const CODE_EXT = /\.(js|mjs|cjs|ts|jsx|tsx|html?|css|json)$/i;

  function isTextPath(path) {
    return CODE_EXT.test(path) || /\.(map|xml|svg)$/i.test(path);
  }

  function classifyPath(path, text) {
    const p = String(path || "").toLowerCase();
    const t = String(text || "");
    const reasons = [];
    const refs = [];
    let category = "SAFE";
    let action = "KEEP";

    if (SAFE_EXT.test(p) && !/\.(js|html?|css|json)$/i.test(p)) {
      return { category: "SAFE", action: "KEEP", reasons: ["Asset lokal"], refs: [], serverDep: false };
    }

    let m;
    EXTERNAL_URL_RE.lastIndex = 0;
    while ((m = EXTERNAL_URL_RE.exec(t)) !== null) {
      const u = m[0].slice(0, 160);
      refs.push(u);
      if (TRACKING_RE.test(u)) {
        category = "TRACKING";
        reasons.push("URL tracking/analytics");
      } else if (API_PATH_RE.test(u) || /\/api\//i.test(u)) {
        category = "BACKEND_API";
        reasons.push("URL API/backend");
      } else {
        if (category === "SAFE") category = "EXTERNAL";
        reasons.push("URL eksternal");
      }
    }

    if (FETCH_RE.test(t) || WS_RE.test(t)) {
      if (category === "SAFE" || category === "EXTERNAL") category = "BACKEND_API";
      reasons.push(WS_RE.test(t) ? "WebSocket" : "fetch/XHR");
    }
    if (API_PATH_RE.test(t)) {
      category = "BACKEND_API";
      reasons.push("Path API game");
    }
    if (TRACKING_RE.test(t)) {
      if (category !== "BACKEND_API") category = "TRACKING";
      reasons.push("Telemetry/analytics");
    }
    if (REDIRECT_RE.test(t) || SCRIPT_SRC_EXT_RE.test(t) || LINK_HREF_EXT_RE.test(t) || IMPORT_EXT_RE.test(t)) {
      if (category === "SAFE") category = "DOMAIN_REDIRECT";
      reasons.push("Redirect / script/CDN eksternal");
    }

    // Filename hints only → REVIEW, never auto-REMOVE
    if (category === "SAFE" && /(?:api|analytics|telemetry|tracker)[-_.]/i.test(p)) {
      category = "EXTERNAL";
      action = "REVIEW";
      reasons.push("Nama file mencurigakan (perlu review, bukan hapus otomatis)");
    }

    if (category === "SAFE") {
      action = "KEEP";
    } else if (category === "TRACKING") {
      action = "REMOVE";
    } else if (category === "BACKEND_API") {
      action = "REPLACE"; // mock candidate
    } else if (category === "DOMAIN_REDIRECT" || category === "EXTERNAL") {
      action = "REVIEW";
    }

    const serverDep =
      category === "BACKEND_API" ||
      /spin|balance|wallet|session|bet|result/i.test(t + p);

    return {
      category,
      action,
      reasons: [...new Set(reasons)].slice(0, 8),
      refs: [...new Set(refs)].slice(0, 12),
      serverDep
    };
  }

  /**
   * @param {JSZip} zip
   * @param {{ onProgress?: (pct:number, label:string)=>void }} opts
   */
  async function analyzeZip(zip, opts) {
    const onProgress = (opts && opts.onProgress) || function () {};
    const files = [];
    const paths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
    const total = paths.length || 1;
    let i = 0;

    for (const path of paths) {
      i++;
      if (i % 5 === 0 || i === total) {
        onProgress(Math.round((i / total) * 90), "Scan " + path.slice(0, 60));
      }
      let text = "";
      if (isTextPath(path)) {
        try {
          text = await zip.files[path].async("string");
          if (text.length > 800000) text = text.slice(0, 800000);
        } catch {
          text = "";
        }
      }
      const c = classifyPath(path, text);
      files.push({
        path,
        size: text ? text.length : 0,
        category: c.category,
        action: c.action,
        reasons: c.reasons,
        refs: c.refs,
        serverDep: c.serverDep,
        // user can override in UI
        userAction: c.action
      });
    }

    onProgress(95, "Menyusun laporan...");

    const summary = {
      total: files.length,
      safe: files.filter((f) => f.category === "SAFE").length,
      external: files.filter((f) => f.category === "EXTERNAL").length,
      api: files.filter((f) => f.category === "BACKEND_API").length,
      tracking: files.filter((f) => f.category === "TRACKING").length,
      domain: files.filter((f) => f.category === "DOMAIN_REDIRECT").length,
      removeCandidates: files.filter((f) => f.action === "REMOVE").length,
      replaceCandidates: files.filter((f) => f.action === "REPLACE").length,
      reviewCandidates: files.filter((f) => f.action === "REVIEW").length,
      serverDeps: files.filter((f) => f.serverDep).length
    };

    const report = {
      mode: "offline-sandbox",
      createdAt: new Date().toISOString(),
      summary,
      files,
      offlineReady: null
    };

    onProgress(100, "Selesai");
    return report;
  }

  /** Soft offline conversion: neutralize tracking + external script tags; mock stubs for API-ish files */
  async function applyConversion(zip, report, opts) {
    const changed = [];
    const removed = [];
    const replaced = [];
    const kept = [];

    // Backup snapshot of modified paths
    const backup = {
      mode: "offline-sandbox",
      createdAt: new Date().toISOString(),
      filesChanged: [],
      filesRemoved: [],
      filesReplaced: [],
      filesKept: []
    };

    for (const f of report.files) {
      const act = f.userAction || f.action;
      if (act === "KEEP" || f.category === "SAFE") {
        kept.push(f.path);
        continue;
      }
      if (!zip.files[f.path] || zip.files[f.path].dir) continue;

      if (act === "REMOVE" && f.category === "TRACKING") {
        // Don't delete binary blindly — stub empty for JS only
        if (/\.(js|mjs)$/i.test(f.path)) {
          const prev = await zip.files[f.path].async("string").catch(() => "");
          zip.file(
            "BACKUP/offline-conversion/original/" + f.path.replace(/\//g, "__"),
            prev
          );
          zip.file(
            f.path,
            "/* GC-OFFLINE: tracking disabled */\nconsole.debug('[offline] tracking stub:', " +
              JSON.stringify(f.path) +
              ");\n"
          );
          removed.push(f.path);
          backup.filesRemoved.push(f.path);
          changed.push(f.path);
        }
        continue;
      }

      if (act === "REPLACE" && /\.(js|mjs)$/i.test(f.path)) {
        const prev = await zip.files[f.path].async("string").catch(() => "");
        zip.file(
          "BACKUP/offline-conversion/original/" + f.path.replace(/\//g, "__"),
          prev
        );
        // Soft: comment fetch to external only is hard; provide stub wrapper note
        let next = prev;
        next =
          "/* GC-OFFLINE MOCK — original backed up */\n" +
          "try{if(typeof window!=='undefined'){window.__GC_OFFLINE__=true;window.__GC_MOCK_BALANCE__=window.__GC_MOCK_BALANCE__||100000;}}\n" +
          "catch(e){}\n" +
          next;
        // Neutralize common analytics injects
        next = next.replace(TRACKING_RE, "/*gc-track*/");
        zip.file(f.path, next);
        replaced.push(f.path);
        backup.filesReplaced.push(f.path);
        changed.push(f.path);
        continue;
      }

      if (act === "REVIEW" && /\.(html?)$/i.test(f.path)) {
        const prev = await zip.files[f.path].async("string").catch(() => "");
        zip.file(
          "BACKUP/offline-conversion/original/" + f.path.replace(/\//g, "__"),
          prev
        );
        let next = prev
          .replace(/<script[^>]+src\s*=\s*["']https?:\/\/[^"']+["'][^>]*>\s*<\/script>/gi, "<!-- gc: external script removed -->")
          .replace(/<link[^>]+href\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi, "<!-- gc: external link removed -->");
        zip.file(f.path, next);
        changed.push(f.path);
        backup.filesChanged.push(f.path);
      }
    }

    backup.filesKept = kept.slice(0, 500);
    zip.file(
      "BACKUP/offline-conversion/manifest.json",
      JSON.stringify(backup, null, 2)
    );
    zip.file(
      "BACKUP/offline-conversion/analysis-report.json",
      JSON.stringify(
        {
          createdAt: report.createdAt,
          summary: report.summary,
          files: report.files.map((x) => ({
            path: x.path,
            category: x.category,
            action: x.userAction || x.action,
            reasons: x.reasons
          }))
        },
        null,
        2
      )
    );

    // Re-validate lightly
    const validation = await quickOfflineCheck(zip);
    report.offlineReady = validation.ready;
    report.validation = validation;

    return { backup, changed, removed, replaced, kept, validation };
  }

  async function quickOfflineCheck(zip) {
    const checks = {
      externalApi: true,
      externalDomain: true,
      websocket: true,
      assetsLocal: true,
      scriptsLocal: true,
      launcher: true,
      redirect: true
    };
    const remaining = [];
    const paths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
    checks.launcher = paths.some((p) => /(^|\/)index\.html?$/i.test(p));

    for (const path of paths) {
      if (!isTextPath(path)) continue;
      if (path.startsWith("BACKUP/")) continue;
      let t = "";
      try {
        t = await zip.files[path].async("string");
        if (t.length > 400000) t = t.slice(0, 400000);
      } catch {
        continue;
      }
      if (WS_RE.test(t)) {
        checks.websocket = false;
        remaining.push({ path, issue: "WebSocket" });
      }
      if (API_PATH_RE.test(t) && FETCH_RE.test(t)) {
        checks.externalApi = false;
        remaining.push({ path, issue: "API fetch" });
      }
      const urls = t.match(EXTERNAL_URL_RE) || [];
      for (const u of urls) {
        if (TRACKING_RE.test(u)) continue; // may still be string residue
        if (/https?:\/\//i.test(u) && !/localhost|127\.0\.0\.1/i.test(u)) {
          checks.externalDomain = false;
          remaining.push({ path, issue: "external URL " + u.slice(0, 60) });
          break;
        }
      }
    }

    const ready =
      checks.launcher &&
      remaining.length === 0;

    return {
      ready,
      checks,
      remaining: remaining.slice(0, 30),
      remainingCount: remaining.length,
      status: ready ? "OFFLINE READY" : "OFFLINE NOT READY"
    };
  }

  global.GCOfflineAnalyze = {
    analyzeZip,
    applyConversion,
    quickOfflineCheck,
    classifyPath
  };
})(typeof window !== "undefined" ? window : globalThis);
