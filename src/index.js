import { analyzeGame, repairMetadata, recommendGames, chatAboutGames } from "./ai.js";
/**
 * Game Collector Pro — Worker entry (modular Poin 5)
 */
import { launch } from "@cloudflare/playwright";
import { zipSync, strToU8, unzipSync } from "fflate";
import { uploadGameToEduNetwork, continueEduUpload, eduConfig } from "./hosting/edu-upload.js";

import { safe } from "./lib/safe.js";
import { TYPES, isExcluded, classifyResource } from "./classify/resource.js";
import { classifySlotSubfolder, folderOf } from "./classify/slot-folder.js";
import { buildAllowedSet, shouldIncludeResource } from "./classify/select-filter.js";
import { classifyApiSemantics } from "./classify/api-semantics.js";
import { buildKeterangan } from "./package/keterangan.js";
import { buildApiMap } from "./package/api-map.js";
import { handleAssetProxy } from "./lib/asset-proxy.js";
import { smartPackage } from "./package/smart-rewrite.js";
import { applyHybridCdnFix } from "./package/hybrid-cdn-fix.js";
import { buildOfflineSuperReport, injectOfflineBootstrap, ensureCriticalApiMocks } from "./package/offline-engine.js";
import { analyzeGameContent } from "./analyze/content.js";
import { analyzeDependencies } from "./analyze/dependency.js";
import { mapAssetRelations } from "./analyze/relations.js";
import { fillMissingAssetsV2 } from "./collect/fill-missing-enhanced.js";
import { normalizeResourceUrl, preferredAssetDir, professionalFileName } from "./collect/normalize.js";
import { postCollectAudit, formatCollectAuditSummary } from "./collect/post-audit.js";
import { runRecoveryEngine } from "./collect/recovery.js";
import { buildDependencyQueue, queueReport } from "./collect/queue.js";
import { staticAnalyzeHtml, staticAnalyzeZip } from "./collect/static-scan.js";
import { buildUrlMap, formatStatusReport } from "./collect/url-map.js";
import { sha256 } from "./offline/strict-collector.js";
import { STRICT_STATUS, markDownloadFailed } from "./classify/resource.js";
import { ghFetch } from "./collect/github.js";
import {
  MAX_SINGLE_FILE,
  MAX_RAW_TOTAL,
  MAX_ZIP_RESPONSE,
  tooLargeResponse,
  sumZipFilesBytes,
  resolveLimits
} from "./collect/limits.js";
import { resumeFetchMissing } from "./collect/resume.js";
import {
  hasKV,
  listHistory,
  putHistory,
  deleteHistory,
  clearHistory,
  saveSession,
  getSession,
  deleteSession
} from "./history/kv.js";
import { parseLogText } from "./history/log-parser.js";
import {
  hasProgressStore,
  setProgress,
  getProgress,
  requestStop,
  isStopRequested,
  clearStop
} from "./progress/store.js";

/** Portable GH config — override via wrangler vars (domain/server baru) */
function ghConfig(env = {}) {
  return {
    owner: env.GH_OWNER || "frostbyte-lab",
    repo: env.GH_REPO || "frostbyte-lab-game--collector",
    workflow: env.GH_WORKFLOW || "collect.yml"
  };
}
const AI_MODELS = { llama: "@cf/meta/llama-3.1-8b-instruct", "qwen3-coder": "@cf/qwen/qwen3-30b-a3b-fp8" };

function cleanAiJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    return {
      summary: raw || "AI tidak mengembalikan hasil.",
      issues: [],
      suggestions: [],
      repairedCode: null
    };
  }
}

async function analyzeWithAI(env, body) {
  if (!env.AI || typeof env.AI.run !== "function") {
    return Response.json({
      ok: false,
      error: "AI_NOT_CONFIGURED",
      message: "Cloudflare Workers AI belum terhubung pada deployment ini."
    }, { status: 503 });
  }

  const filename = String(body.filename || "untitled");
  const language = String(body.language || "plaintext");
  const code = String(body.code || "").slice(0, 30000);
  const staticIssues = Array.isArray(body.staticIssues) ? body.staticIssues.slice(0, 20) : [];
  const action = body.action === "repair" ? "repair" : body.action === "chat" ? "chat" : "analyze";
  const userQuestion = String(body.question || "").slice(0, 2000);
  const modelKey = body.model === "qwen3-coder" ? "qwen3-coder" : "llama";
  const model = AI_MODELS[modelKey];

  const outputSchema = action === "repair"
    ? `{"summary":"...","issues":[{"severity":"error|warning|info","line":1,"message":"..."}],"suggestions":["..."],"repairedCode":"FULL FILE CONTENT"}`
    : `{"summary":"...","issues":[{"severity":"error|warning|info","line":1,"message":"..."}],"suggestions":["actionable fix 1","actionable fix 2"],"repairedCode":null}`;

  const system = [
    "You are a careful code review assistant inside Game Collector Pro.",
    "Analyze only the supplied file. Never invent missing files or claim code was executed.",
    "Return valid JSON only. Keep explanations concise and actionable.",
    "Detect syntax errors, broken paths, unsafe browser assumptions, missing dependencies, and likely runtime errors.",
    "When a line is unknown, use null rather than guessing.",
    modelKey === "qwen3-coder" ? "Work in Qwen3-Coder mode: prioritize precise code reasoning and safe complete repairs." : "",
    "The response schema is " + outputSchema
  ].filter(Boolean).join(" ");
  const task = action === "repair"
    ? "Find the most important fixable problems and return the complete corrected file in repairedCode. Preserve behavior and formatting where possible."
    : action === "chat"
      ? "Answer the user's question about this file with concrete, safe guidance. Do not return repairedCode."
      : "Review this file and report likely errors plus practical repair steps. Do not return repairedCode.";

  const user = [
    `File: ${filename}`,
    `Language: ${language}`,
    `Static checks already found: ${JSON.stringify(staticIssues)}`,
    userQuestion ? `User question: ${userQuestion}` : "",
    task,
    "Code:",
    code
  ].filter(Boolean).join("\n\n");

  try {
    const result = await env.AI.run(model, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });
    const parsed = cleanAiJson(result?.response || result?.result?.response || "");
    return Response.json({ ok: true, model, modelKey, modelLabel: modelKey === "qwen3-coder" ? "Qwen3-Coder" : "Llama 3.1", ...parsed });
  } catch (error) {
    return Response.json({
      ok: false,
      error: "AI_REQUEST_FAILED",
      message: String(error?.message || error).slice(0, 500)
    }, { status: 502 });
  }
}


/** Deteksi paket collect tidak usable (kosong / halaman blokir) */
function detectCollectFailure(html, manifest, gameCount, mainDocStatus = 0) {
  const h = String(html || "");
  const hl = h.toLowerCase();
  const blocked =
    (Number(mainDocStatus) >= 400) ||
    /\b403\s*forbidden\b/i.test(h) ||
    /request forbidden by administrative rules/i.test(h) ||
    /\b401\s*unauthorized\b/i.test(h) ||
    /\baccess denied\b/i.test(h) ||
    /\bcaptcha\b/i.test(hl) && /\b(challenge|verify|robot|cloudflare)\b/i.test(hl) ||
    /attention required|enable javascript and cookies/i.test(hl) ||
    /just a moment/i.test(hl) && /cloudflare/i.test(hl);
  const empty = !manifest || manifest.length === 0 || (gameCount !== undefined && gameCount === 0 && (manifest.length || 0) < 3);
  // index only meta without real assets
  const onlyShell = (manifest || []).length === 0 && h.length < 500;
  let reason = null;
  if (blocked) reason = "TARGET_BLOCKED";
  else if (empty || onlyShell) reason = "EMPTY_PACKAGE";
  return {
    failed: Boolean(reason),
    reason,
    blocked: Boolean(blocked),
    empty: Boolean(empty || onlyShell),
    message:
      reason === "TARGET_BLOCKED"
        ? "Situs memblokir akses collect (403/challenge). Tidak ada asset game yang bisa diambil."
        : reason === "EMPTY_PACKAGE"
          ? "Collect selesai tapi 0 asset game. Paket tidak usable untuk preview offline."
          : null
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health
    if (request.method === "GET" && url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "game-collector-pro",
        version: "4.4-proxy",
        github: Boolean(env.GITHUB_TOKEN),
        assetProxy: true,
        limits: {
          mode: env.COLLECTOR_BUCKET
            ? "worker + r2-large + github-actions-fallback"
            : "worker-small + github-actions-large",
          maxSingleFileMB: Math.round(MAX_SINGLE_FILE / 1024 / 1024),
          maxRawTotalMB: Math.round(MAX_RAW_TOTAL / 1024 / 1024),
          maxZipResponseMB: Math.round(MAX_ZIP_RESPONSE / 1024 / 1024),
          r2: Boolean(env.COLLECTOR_BUCKET),
          historyKV: hasKV(env),
          progressKV: hasProgressStore(env),
          assetProxyMaxMB: 12
        }
      });
    }

    // Asset proxy same-origin (tanpa R2) — Hybrid online
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname === "/api/asset-proxy"
    ) {
      return handleAssetProxy(request, url);
    }

    if (request.method === "POST" && url.pathname === "/api/ai/analyze") {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
      }
      if (!body || typeof body.code !== "string" || !body.code.trim()) {
        return Response.json({ ok: false, error: "CODE_REQUIRED" }, { status: 400 });
      }
      return analyzeWithAI(env, body);
    }

    // --- R2 download (Poin 1) — stream ZIP besar dari R2 ---
    if (request.method === "GET" && url.pathname === "/api/r2/download") {
      const key = url.searchParams.get("key");
      if (!key || key.includes("..") || key.startsWith("/")) {
        return Response.json({ error: "key tidak valid" }, { status: 400 });
      }
      if (!env.COLLECTOR_BUCKET) {
        return Response.json({ error: "R2 belum di-bind (COLLECTOR_BUCKET)" }, { status: 503 });
      }
      const obj = await env.COLLECTOR_BUCKET.get(key);
      if (!obj) {
        return Response.json({ error: "File tidak ditemukan di R2" }, { status: 404 });
      }
      const filename = key.split("/").pop() || "game-package.zip";
      return new Response(obj.body, {
        status: 200,
        headers: {
          "Content-Type": obj.httpMetadata?.contentType || "application/zip",
          "Content-Disposition": obj.httpMetadata?.contentDisposition ||
            `attachment; filename="${filename}"`,
          "Cache-Control": "private, max-age=3600",
          "X-GC-Via": "r2"
        }
      });
    }


    // --- Activity: one-shot / session token deploy (token TIDAK disimpan di Worker) ---
    if (request.method === "POST" && url.pathname === "/api/activity/session-deploy") {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ ok: false, error: "JSON tidak valid" }, { status: 400 });
      }
      const target = String(body.target || "cloudflare").toLowerCase(); // github | cloudflare
      // Token sekali kirim dari klien (sesi tab). Jangan log / jangan KV.
      const sessionToken = String(body.token || body.github_token || "").trim();
      const token = sessionToken || env.GITHUB_TOKEN || "";
      if (!token) {
        return Response.json(
          {
            ok: false,
            error: "Token GitHub diperlukan (sekali pakai di sesi). Tempel PAT saat diminta, atau set GITHUB_TOKEN di Worker."
          },
          { status: 401 }
        );
      }
      const owner = env.GH_OWNER || "frostbyte-lab";
      const repo = env.GH_REPO || "frostbyte-lab-game--collector";
      // Cloudflare deploy = trigger workflow deploy.yml; github = empty commit note via dispatch deploy juga
      const workflow = target === "github" ? String(body.workflow || "deploy.yml") : String(body.workflow || "deploy.yml");
      const ref = String(body.ref || "main");
      try {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
          {
            method: "POST",
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${token}`,
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "game-collector-pro-activity",
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ ref })
          }
        );
        if (res.status === 204 || res.ok) {
          await new Promise((r) => setTimeout(r, 1200));
          const runsRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?per_page=3&event=workflow_dispatch`,
            {
              headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${token}`,
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "game-collector-pro-activity"
              }
            }
          );
          const runsData = await runsRes.json().catch(() => ({}));
          const run = runsData.workflow_runs && runsData.workflow_runs[0];
          return Response.json({
            ok: true,
            target,
            message:
              target === "cloudflare"
                ? "Deploy workflow dipicu. Cloudflare akan ter-update setelah Actions selesai."
                : "Workflow GitHub dipicu.",
            run_id: run && run.id,
            run_url: (run && run.html_url) || `https://github.com/${owner}/${repo}/actions`,
            status: (run && run.status) || "queued",
            token_mode: sessionToken ? "session_one_shot" : "worker_secret"
          });
        }
        const errText = await res.text();
        let errData = null;
        try {
          errData = JSON.parse(errText);
        } catch {
          errData = { raw: errText.slice(0, 400) };
        }
        return Response.json(
          {
            ok: false,
            status: res.status,
            error: (errData && (errData.message || errData.error)) || "Gagal dispatch workflow",
            detail: errData
          },
          { status: res.status >= 400 ? res.status : 500 }
        );
      } catch (e) {
        return Response.json({ ok: false, error: e.message || String(e) }, { status: 502 });
      }
    }

    // --- Trigger GitHub Actions collect from web ---
    if (request.method === "POST" && url.pathname === "/api/github/collect") {
      let body;
      try { body = await request.json(); } catch {
        return Response.json({ error: "JSON tidak valid" }, { status: 400 });
      }
      const gameUrl = String(body.url || "").trim();
      const waitSeconds = String(body.wait_seconds || "22");
      try {
        const u = new URL(gameUrl);
        if (!["http:", "https:"].includes(u.protocol)) throw 0;
      } catch {
        return Response.json({ error: "URL http/https tidak valid" }, { status: 400 });
      }

      const dispatch = await ghFetch(env, `/repos/${ghConfig(env).owner}/${ghConfig(env).repo}/actions/workflows/${ghConfig(env).workflow}/dispatches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            url: gameUrl,
            wait_seconds: waitSeconds,
            auto_spins: String(body.auto_spins ?? body.autoSpins ?? "6"),
            auto_history: String(body.auto_history ?? body.autoHistory ?? "1"),
            spin_delay_ms: String(body.spin_delay_ms ?? body.spinDelayMs ?? "2200"),
            seed_zip: String(body.seed_zip ?? body.seedZip ?? "")
          }
        })
      });

      if (dispatch.status === 204 || dispatch.ok) {
        // Ambil run terbaru (sedikit delay di client; di sini coba list)
        await new Promise(r => setTimeout(r, 1500));
        const runs = await ghFetch(env, `/repos/${ghConfig(env).owner}/${ghConfig(env).repo}/actions/workflows/${ghConfig(env).workflow}/runs?per_page=5&event=workflow_dispatch`);
        const run = runs.data?.workflow_runs?.[0] || null;
        return Response.json({
          ok: true,
          message: "GitHub Actions dimulai. Tunggu 1–3 menit, lalu cek status.",
          run_id: run?.id || null,
          run_url: run?.html_url || `https://github.com/${ghConfig(env).owner}/${ghConfig(env).repo}/actions`,
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
      const run = await ghFetch(env, `/repos/${ghConfig(env).owner}/${ghConfig(env).repo}/actions/runs/${runId}`);
      if (!run.ok) return Response.json({ error: "Gagal ambil status", detail: run.data }, { status: run.status });
      const r = run.data;

      // Detail job + steps (apa yang sedang dijalankan)
      let jobsOut = [];
      let currentStep = null;
      try {
        const jobs = await ghFetch(env, `/repos/${ghConfig(env).owner}/${ghConfig(env).repo}/actions/runs/${runId}/jobs`);
        const list = jobs.data?.jobs || [];
        for (const job of list) {
          const steps = (job.steps || []).map(s => ({
            name: s.name,
            status: s.status,
            conclusion: s.conclusion,
            number: s.number
          }));
          jobsOut.push({
            name: job.name,
            status: job.status,
            conclusion: job.conclusion,
            steps
          });
          for (const s of steps) {
            if (s.status === "in_progress") currentStep = s.name;
          }
          if (!currentStep && job.status === "in_progress") {
            const last = [...steps].reverse().find(s => s.conclusion === "success") || steps[steps.length - 1];
            if (last) currentStep = last.name + (last.conclusion === "success" ? " (selesai, lanjut...)" : "");
          }
        }
      } catch {}

      // Fase ramah pengguna dari nama step
      const phaseHint = (() => {
        const n = (currentStep || "").toLowerCase();
        if (!n && r.status === "queued") return "Antri di GitHub Actions...";
        if (n.includes("checkout") || n.includes("set up job")) return "Menyiapkan runner & clone repo";
        if (n.includes("setup node") || n.includes("install")) return "Install Node + Playwright (browser)";
        if (n.includes("capture") || n.includes("collect")) return "Membuka URL game, scroll, ambil HTML/JS/CSS/gambar/audio, packaging ZIP";
        if (n.includes("upload") || n.includes("artifact")) return "Upload artifact ZIP ke GitHub";
        if (n.includes("summary")) return "Menulis ringkasan hasil";
        if (r.status === "completed") return r.conclusion === "success" ? "Selesai" : "Gagal";
        return currentStep ? ("Menjalankan: " + currentStep) : "Sedang diproses di runner GitHub...";
      })();

      let artifact = null;
      if (r.status === "completed" && r.conclusion === "success") {
        const arts = await ghFetch(env, `/repos/${ghConfig(env).owner}/${ghConfig(env).repo}/actions/runs/${runId}/artifacts`);
        artifact = arts.data?.artifacts?.[0] || null;
      }
      return Response.json({
        ok: true,
        run_id: r.id,
        status: r.status,
        conclusion: r.conclusion,
        html_url: r.html_url,
        run_started_at: r.run_started_at || r.created_at,
        updated_at: r.updated_at,
        current_step: currentStep,
        phase: phaseHint,
        jobs: jobsOut,
        artifact: artifact ? { id: artifact.id, name: artifact.name, size: artifact.size_in_bytes } : null
      });
    }

    // --- Download artifact ZIP (proxy) — unwrap nested GitHub Actions zip ---
    if (request.method === "GET" && url.pathname === "/api/github/artifact") {
      const artifactId = url.searchParams.get("artifact_id");
      if (!artifactId) return Response.json({ error: "artifact_id wajib" }, { status: 400 });
      const token = env.GITHUB_TOKEN;
      if (!token) return Response.json({ error: "GITHUB_TOKEN belum di-set" }, { status: 500 });
      const res = await fetch(`https://api.github.com/repos/${ghConfig(env).owner}/${ghConfig(env).repo}/actions/artifacts/${artifactId}/zip`, {
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
      const outerBuf = new Uint8Array(await res.arrayBuffer());
      let outBytes = outerBuf;
      let filename = "game-resources.zip";
      try {
        const entries = unzipSync(outerBuf);
        const names = Object.keys(entries).filter((n) => !n.endsWith("/") && entries[n]?.length);
        const innerZips = names.filter((n) => /\.zip$/i.test(n));
        // GitHub Actions membungkus 1 file ZIP hasil collect → ambil isi dalamnya
        if (innerZips.length === 1 && names.length === 1) {
          outBytes = entries[innerZips[0]];
          filename = innerZips[0].split("/").pop() || filename;
        } else if (innerZips.length === 1 && names.length <= 3) {
          // kadang ada file ekstra kecil (log) — prioritaskan zip terbesar
          let best = innerZips[0];
          for (const n of innerZips) {
            if ((entries[n]?.length || 0) > (entries[best]?.length || 0)) best = n;
          }
          outBytes = entries[best];
          filename = best.split("/").pop() || filename;
        }
      } catch {
        // bukan zip valid / sudah flat — kirim outer apa adanya
      }
      return new Response(outBytes, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.\-]+/g, "_")}"`,
          "X-GC-Artifact-Unwrapped": outBytes === outerBuf ? "0" : "1",
          "X-GC-Bytes": String(outBytes.byteLength)
        }
      });
    }

    // --- AI Studio ---
      if (request.method === "POST" && url.pathname === "/api/ai") {
        let body = {};
        try { body = await request.json(); } catch { return Response.json({ error: "JSON tidak valid" }, { status: 400 }); }
        try {
          const action = String(body.action || "");
          let result;
          if (action === "analyze") result = await analyzeGame(env, body.data);
          else if (action === "repair") result = await repairMetadata(env, body.data);
          else if (action === "recommend") result = await recommendGames(env, body.data);
          else if (action === "chat" && body.question) result = await chatAboutGames(env, body.question, body.context);
          else return Response.json({ error: "action harus analyze, repair, recommend, atau chat" }, { status: 400 });
          return Response.json({ ok: true, action, result });
        } catch (error) {
          return Response.json({ ok: false, error: error?.message || "AI gagal memproses permintaan" }, { status: 503 });
        }
      }

        // --- Progress collect (poll) ---
    if (request.method === "GET" && url.pathname === "/api/progress") {
      const id = url.searchParams.get("id");
      if (!id) return Response.json({ error: "id required" }, { status: 400 });
      if (!hasProgressStore(env)) {
        return Response.json({
          ok: false,
          error: "NO_KV",
          message: "Progress server butuh KV GC_HISTORY"
        }, { status: 503 });
      }
      const row = await getProgress(env, id);
      if (!row) {
        return Response.json({ ok: true, id, pct: 0, phase: "waiting", label: "Menunggu collect...", done: false });
      }
      return Response.json({ ok: true, ...row });
    }

    // --- Stop Capture (Live Viewer) ---
    if (request.method === "POST" && url.pathname === "/api/collect/stop") {
      let body = {};
      try { body = await request.json(); } catch {}
      const id = String(body.progressId || body.id || url.searchParams.get("id") || "").slice(0, 80);
      if (!id) return Response.json({ error: "progressId required" }, { status: 400 });
      if (!hasProgressStore(env)) {
        return Response.json({ ok: false, error: "NO_KV" }, { status: 503 });
      }
      const ok = await requestStop(env, id);
      return Response.json({ ok, id, message: ok ? "Stop diminta" : "Gagal set stop flag" });
    }

    // --- Import browser/collector log into server-side history ---
    if (request.method === "POST" && url.pathname === "/api/history/import-log") {
      let body = {};
      try { body = await request.json(); } catch { return Response.json({ ok: false, error: "INVALID_JSON" }, { status: 400 }); }
      let raw = typeof body.raw === "string" ? body.raw : "";
      const sourcePath = typeof body.path === "string" ? body.path.trim() : "";
      if (!raw && sourcePath) {
        const safePath = sourcePath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
        const file = await ghFetch(env, `/repos/${ghConfig(env).owner}/${ghConfig(env).repo}/contents/${safePath}?ref=${encodeURIComponent(String(body.ref || "main"))}`);
        if (!file.ok || !file.data?.content) return Response.json({ ok: false, error: "GITHUB_LOG_NOT_FOUND", detail: file.data }, { status: file.status || 404 });
        raw = atob(String(file.data.content).replace(/\s/g, ""));
      }
      if (!raw.trim()) return Response.json({ ok: false, error: "LOG_REQUIRED", message: "Kirim raw log atau path file log di GitHub." }, { status: 400 });
      const parsed = parseLogText(raw);
      const entry = { id: crypto.randomUUID(), url: parsed.page || "", status: parsed.errors.length ? "error_imported" : "log_imported", files: 0, message: "Log diimpor" + (sourcePath ? " dari " + sourcePath : "") + (parsed.errorCode ? " — " + parsed.errorCode : ""), source: sourcePath ? "github" : "file", kind: "runtime-error-log", errorCode: parsed.errorCode, ip: parsed.ip, userAgent: parsed.userAgent, details: parsed.errors, time: parsed.time };
      const saved = await putHistory(env, entry);
      if (!saved.ok && saved.reason === "no-kv") return Response.json({ ok: false, error: "NO_KV", message: "KV GC_HISTORY belum di-bind." }, { status: 503 });
      return Response.json({ ok: true, saved, entry, parsed: { ip: parsed.ip, page: parsed.page, errorCode: parsed.errorCode, time: parsed.time, userAgent: parsed.userAgent, errors: parsed.errors } });
    }

    // --- History (KV) ---
    if (url.pathname === "/api/history") {
      if (request.method === "GET") {
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 30)));
        const data = await listHistory(env, limit);
        return Response.json({
          ok: true,
          kv: hasKV(env),
          ...data
        });
      }
      if (request.method === "POST") {
        let body;
        try { body = await request.json(); } catch {
          return Response.json({ error: "JSON tidak valid" }, { status: 400 });
        }
        const result = await putHistory(env, body || {});
        if (!result.ok && result.reason === "no-kv") {
          return Response.json({
            ok: false,
            error: "NO_KV",
            message: "KV GC_HISTORY belum di-bind. Riwayat tetap bisa di localStorage. Lihat README untuk setup."
          }, { status: 503 });
        }
        return Response.json(result);
      }
      if (request.method === "DELETE") {
        const id = url.searchParams.get("id");
        if (id === "all") {
          const r = await clearHistory(env);
          return Response.json(r);
        }
        if (!id) return Response.json({ error: "id required" }, { status: 400 });
        const r = await deleteHistory(env, id);
        return Response.json(r);
      }
    }

    // --- Resume / partial collect (tanpa browser) ---
    if (request.method === "POST" && url.pathname === "/api/resume") {
      let body;
      try { body = await request.json(); } catch {
        return Response.json({ error: "JSON tidak valid" }, { status: 400 });
      }
      const sessionId = body.sessionId || body.id || null;
      let stillMissing = body.stillMissing || [];
      let targetUrl = String(body.url || "").trim();
      let seenList = Array.isArray(body.seen) ? body.seen : [];

      if (sessionId) {
        const sess = await getSession(env, sessionId);
        if (sess) {
          if (!targetUrl) targetUrl = sess.url || "";
          if (!stillMissing.length) stillMissing = sess.stillMissing || [];
          if (!seenList.length) seenList = sess.seen || [];
        } else if (!stillMissing.length) {
          return Response.json({
            error: "SESSION_NOT_FOUND",
            message: "Session resume tidak ditemukan / expired. Kirim stillMissing[] manual atau collect ulang."
          }, { status: 404 });
        }
      }

      if (!targetUrl && !stillMissing.length) {
        return Response.json({ error: "url atau stillMissing wajib" }, { status: 400 });
      }

      const seen = new Set(seenList);
      const zipFiles = {};
      const manifest = [];
      // Optional: seed existing tiny files not practical without R2 — resume hanya fetch missing
      const report = await resumeFetchMissing(
        stillMissing,
        seen,
        zipFiles,
        manifest,
        targetUrl || (stillMissing[0] && (stillMissing[0].url || stillMissing[0])),
        Math.min(120, Number(body.maxFetch) || 80)
      );

      // Pack partial ZIP of newly fetched only (fflate sudah di-import di top-level)
      zipFiles["_resume-report.json"] = strToU8(JSON.stringify({
        target: targetUrl,
        sessionId,
        report,
        resumedAt: new Date().toISOString()
      }, null, 2));

      const zipData = zipSync(zipFiles, { level: 6 });

      // Update session if KV
      let newSessionId = null;
      if (hasKV(env) && report.stillMissing.length) {
        const saved = await saveSession(env, {
          id: sessionId || crypto.randomUUID(),
          url: targetUrl,
          phase: "partial",
          seen: [...seen],
          stillMissing: report.stillMissing,
          note: "resume-partial"
        });
        newSessionId = saved.id;
      } else if (sessionId && !report.stillMissing.length) {
        await deleteSession(env, sessionId);
      }

      // History entry
      if (hasKV(env)) {
        await putHistory(env, {
          id: crypto.randomUUID(),
          url: targetUrl,
          status: report.stillMissing.length ? "resume_partial" : "resume_ok",
          files: report.fetched,
          message: `Resume: +${report.fetched} file, still ${report.stillMissing.length}`,
          stillMissing: report.stillMissing.slice(0, 50)
        });
      }

      return new Response(zipData, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="resume-${(sessionId || "partial").slice(0, 8)}.zip"`,
          "X-GC-Resume-Fetched": String(report.fetched),
          "X-GC-Resume-Failed": String(report.failed),
          "X-GC-Resume-Still": String(report.stillMissing.length),
          "X-GC-Session-Id": newSessionId || sessionId || "",
          "X-GC-Mode": "resume"
        }
      });
    }

    // --- Hosting: upload ZIP ke Edu-network (Git commit → Pages) ---
    if (request.method === "GET" && url.pathname === "/api/hosting/config") {
      const cfg = eduConfig(env);
      return Response.json({
        ok: true,
        edu: cfg,
        has_github_token: Boolean(env.GITHUB_TOKEN),
        slots: { min: 1, max: 150 }
      });
    }

    if (request.method === "POST" && url.pathname === "/api/hosting/upload") {
      let gameSlot = 0;
      let commitMessage = "";
      /** @type {Record<string, Uint8Array>} */
      let filesMap = {};
      /** @type {Uint8Array|null} */
      let rawZipBytes = null;
      const ct = (request.headers.get("content-type") || "").toLowerCase();
      try {
        if (ct.includes("multipart/form-data")) {
          const form = await request.formData();
          gameSlot = Number(form.get("game_slot") || form.get("slot") || 0);
          commitMessage = String(form.get("message") || "").trim();
          const zipFile = form.get("zip") || form.get("file");
          if (!zipFile || typeof zipFile.arrayBuffer !== "function") {
            return Response.json({ ok: false, error: "Field zip (file) wajib" }, { status: 400 });
          }
          const buf = new Uint8Array(await zipFile.arrayBuffer());
          if (buf.byteLength < 22) {
            return Response.json({ ok: false, error: "ZIP kosong / tidak valid" }, { status: 400 });
          }
          if (buf.byteLength > 80 * 1024 * 1024) {
            return Response.json({ ok: false, error: "ZIP terlalu besar (maks ~80 MB raw)" }, { status: 400 });
          }
          rawZipBytes = buf;
          let unzipped;
          try {
            unzipped = unzipSync(buf);
          } catch (e) {
            return Response.json({ ok: false, error: "Gagal extract ZIP: " + (e?.message || e) }, { status: 400 });
          }
          for (const [name, data] of Object.entries(unzipped)) {
            if (name.endsWith("/")) continue;
            filesMap[name] = data;
          }
        } else {
          const bodyUp = await request.json();
          gameSlot = Number(bodyUp.game_slot || bodyUp.slot || 0);
          commitMessage = String(bodyUp.message || "").trim();
          const files = bodyUp.files || {};
          for (const [name, b64] of Object.entries(files)) {
            if (typeof b64 !== "string") continue;
            try {
              const binary = atob(b64);
              const out = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
              filesMap[name] = out;
            } catch {
              /* skip */
            }
          }
        }
      } catch (e) {
        return Response.json({ ok: false, error: "Body tidak valid: " + (e?.message || e) }, { status: 400 });
      }

      const wantStream =
        url.searchParams.get("stream") === "1" ||
        (request.headers.get("accept") || "").includes("application/x-ndjson");

      if (wantStream) {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const enc = new TextEncoder();
        const send = async (obj) => {
          await writer.write(enc.encode(JSON.stringify(obj) + "\n"));
        };
        (async () => {
          try {
            await send({ type: "phase", phase: "start", message: "Server menerima paket…", pct: 5 });
            const result = await uploadGameToEduNetwork(
              env,
              gameSlot,
              filesMap,
              commitMessage || undefined,
              async (ev) => {
                await send(ev);
              },
              rawZipBytes
            );
            if (result && result.continue) {
              await send({
                type: "continue",
                session_id: result.session_id,
                done: result.done,
                total: result.total,
                remaining: result.remaining,
                need_zip: false,
                pct: result.total ? 20 + Math.round((result.done / result.total) * 65) : 50,
                message: `Batch 1 selesai (${result.done}/${result.total}). Lanjut ${result.remaining} file…`
              });
            } else if (result && result.ok) {
              await send({ type: "done", pct: 100, result });
            } else {
              await send({
                type: "error",
                error: (result && result.error) || "upload gagal",
                detail: result && result.detail,
                status: result && result.status
              });
            }
          } catch (e) {
            try {
              await send({ type: "error", error: e?.message || String(e) });
            } catch (_) {}
          } finally {
            try {
              await writer.close();
            } catch (_) {}
          }
        })();
        return new Response(readable, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      const result = await uploadGameToEduNetwork(env, gameSlot, filesMap, commitMessage || undefined);
      return Response.json(result, { status: result.ok || result.continue ? 200 : result.status || 500 });
    }

    // Lanjut batch upload (hindari "Too many subrequests")
    if (request.method === "POST" && url.pathname === "/api/hosting/upload-continue") {
      const wantStream =
        url.searchParams.get("stream") === "1" ||
        (request.headers.get("accept") || "").includes("application/x-ndjson");
      let sessionId = "";
      let filesMap = {};
      try {
        const ct = (request.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("multipart/form-data")) {
          const form = await request.formData();
          sessionId = String(form.get("session_id") || "");
          const zipFile = form.get("zip") || form.get("file");
          if (zipFile && typeof zipFile.arrayBuffer === "function") {
            const buf = new Uint8Array(await zipFile.arrayBuffer());
            const unzipped = unzipSync(buf);
            for (const [name, data] of Object.entries(unzipped)) {
              if (!name.endsWith("/")) filesMap[name] = data;
            }
          }
        } else {
          const body = await request.json();
          sessionId = String(body.session_id || "");
          for (const [name, b64] of Object.entries(body.files || {})) {
            if (typeof b64 !== "string") continue;
            try {
              const binary = atob(b64);
              const out = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
              filesMap[name] = out;
            } catch {
              /* skip */
            }
          }
        }
      } catch (e) {
        return Response.json({ ok: false, error: "Body tidak valid: " + (e?.message || e) }, { status: 400 });
      }
      if (!sessionId) {
        return Response.json({ ok: false, error: "session_id wajib" }, { status: 400 });
      }

      // Session continue: sisa binary biasanya di edu-bin (hasBinPack), bukan edu-zip.
      // Client sering kirim session_id saja (need_zip:false) — jangan wajibkan filesMap.
      let sessionHasBinPack = false;
      let sessionMetaOk = false;
      if (env.GC_HISTORY) {
        try {
          const rawSess = await env.GC_HISTORY.get(`edu-up:${sessionId}`);
          if (rawSess) {
            sessionMetaOk = true;
            try {
              const sess = JSON.parse(rawSess);
              sessionHasBinPack = Boolean(sess && sess.hasBinPack);
            } catch (_) {}
          }
        } catch (_) {}
      }

      // Optional: load ZIP fallback jika client tidak kirim file & tidak ada bin pack
      if (Object.keys(filesMap).length === 0 && env.GC_HISTORY && !sessionHasBinPack) {
        try {
          const zipBuf = await env.GC_HISTORY.get(`edu-zip:${sessionId}`, { type: "arrayBuffer" });
          if (zipBuf) {
            const unzipped = unzipSync(new Uint8Array(zipBuf));
            for (const [name, data] of Object.entries(unzipped)) {
              if (!name.endsWith("/")) filesMap[name] = data;
            }
          }
        } catch (e) {
          return Response.json(
            { ok: false, error: "Gagal load ZIP session: " + (e?.message || e) },
            { status: 500 }
          );
        }
      }

      if (Object.keys(filesMap).length === 0 && !sessionHasBinPack) {
        if (!sessionMetaOk) {
          return Response.json(
            {
              ok: false,
              error: "Session upload tidak ditemukan / expired. Upload ulang dari awal."
            },
            { status: 404 }
          );
        }
        return Response.json(
          {
            ok: false,
            error: "Tidak ada file untuk continue (bin pack & ZIP kosong). Upload ulang dari awal."
          },
          { status: 400 }
        );
      }
      // filesMap boleh kosong jika sessionHasBinPack — continueEduUpload baca edu-bin sendiri

      if (wantStream) {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const enc = new TextEncoder();
        const send = async (obj) => {
          await writer.write(enc.encode(JSON.stringify(obj) + "\n"));
        };
        (async () => {
          try {
            const result = await continueEduUpload(env, sessionId, filesMap, async (ev) => {
              await send(ev);
            });
            // Event penutup eksplisit — client butuh done/continue/error
            if (result && result.continue) {
              await send({
                type: "continue",
                session_id: result.session_id,
                done: result.done,
                total: result.total,
                remaining: result.remaining,
                need_zip: false,
                pct: result.total ? 20 + Math.round((result.done / result.total) * 65) : 50,
                message: `Batch selesai (${result.done}/${result.total}). Lanjut ${result.remaining} file…`
              });
            } else if (result && result.ok) {
              await send({ type: "done", pct: 100, result });
            } else {
              await send({
                type: "error",
                error: (result && result.error) || "continue gagal",
                detail: result && result.detail,
                status: result && result.status
              });
            }
          } catch (e) {
            try {
              await send({ type: "error", error: e?.message || String(e) });
            } catch (_) {}
          } finally {
            try {
              await writer.close();
            } catch (_) {}
          }
        })();
        return new Response(readable, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store"
          }
        });
      }

      const result = await continueEduUpload(env, sessionId, filesMap);
      return Response.json(result, { status: result.ok || result.continue ? 200 : result.status || 500 });
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

    // Selective collect filter (include/exclude by category or subfolder)
    const { allowed: selectAllowed, rawInclude, rawExclude } = buildAllowedSet(
      body.include || body.includeCategories || body.categories,
      body.exclude || body.excludeCategories
    );

    // Collect options (process 4)
    // Offline-first (catatan proses baru): Wait 22s, spins 6
    const unlimited = !!(body.unlimited || body.no_limit || body.noLimit || body.mode === "unlimited");
    const limits = resolveLimits(env, { unlimited });
    const waitSeconds = Math.min(limits.maxWaitSec || 120, Math.max(3, Number(body.wait_seconds || body.waitSeconds || 22) || 22));
    const autoSpins = Math.min(limits.maxSpins || 30, Math.max(0, Number(body.auto_spins ?? body.autoSpins ?? 6) || 6));

    const spinDelayMs = Math.min(8000, Math.max(500, Number(body.spin_delay_ms ?? body.spinDelayMs ?? 2200) || 2200));
    // collectMode: static | runtime | full (default)
    const collectMode = String(body.mode || body.collect_mode || body.collectMode || "full").toLowerCase();
    const modeStatic = collectMode === "static";
    const modeRuntime = collectMode === "runtime" || collectMode === "full" || !modeStatic;
    const modeFull = collectMode === "full" || (!modeStatic && collectMode !== "runtime");

    const id = crypto.randomUUID();
    const limSingle = (typeof limits !== "undefined" && limits.maxSingleFile) || MAX_SINGLE_FILE;
    const limRaw = (typeof limits !== "undefined" && limits.maxRawTotal) || MAX_RAW_TOTAL;
    const limZip = (typeof limits !== "undefined" && limits.maxZipResponse) || MAX_ZIP_RESPONSE;
    const fillPerPass = (typeof limits !== "undefined" && limits.fillPerPass) || 250;
    const fillPasses = (typeof limits !== "undefined" && limits.fillPasses) || 8;

    const progressId = String(body.progressId || body.progress_id || id).slice(0, 80);
    await clearStop(env, progressId);
    const report = async (pct, phase, label, extra = {}) => {
      // jangan timpa screenshot lama kecuali ada yang baru
      const prev = extra.screenshot ? null : await getProgress(env, progressId);
      const shot = extra.screenshot !== undefined
        ? extra.screenshot
        : (prev && prev.screenshot) || null;
      return setProgress(env, progressId, {
        pct,
        phase,
        label,
        ...extra,
        screenshot: shot,
        stopRequested: extra.stopRequested || (prev && prev.stopRequested) || false
      });
    };

    /** Ambil screenshot kecil untuk Live Viewer */
    const snap = async (page) => {
      try {
        const buf = await page.screenshot({
          type: "jpeg",
          quality: 42,
          fullPage: false
        });
        const b64 = Buffer.from(buf).toString("base64");
        return "data:image/jpeg;base64," + b64;
      } catch {
        return null;
      }
    };

    /** Cek apakah user tekan Stop */
    const shouldStop = async () => isStopRequested(env, progressId);

    await report(2, "init", "Menyiapkan collect...");
    const manifest = [];
    const seen = new Set();
    const zipFiles = {};
    const runtimeBodies = new Map(); // url -> body for Recovery Engine
    const recentCapture = [];
    let lastCaptureReport = 0;
    const expectedRefs = new Set(); // skema/referensi yang ditemukan di HTML/JS
    // Tracker ukuran untuk guard tanpa R2
    const sizeState = { rawBytes: 0, skippedLarge: 0, stoppedForSize: false };

    let browser;
    try {
      // === Launch browser (ini yang kena limit Cloudflare Free) ===
      try {
        browser = await launch(env.MYBROWSER);
      } catch (launchErr) {
        const msg = String(launchErr.message || launchErr);
        if (msg.includes("429") || msg.includes("Rate limit") || msg.includes("limit exceeded")) {
          await report(0, "error", "Limit browser Cloudflare tercapai", { done: true, error: "LIMIT_BROWSER" });
          return Response.json({
            error: "LIMIT_BROWSER",
            message: "Limit browser Cloudflare Free (10 menit/hari) sudah tercapai. Coba lagi besok, atau gunakan GitHub Actions (gratis tanpa limit).",
            tip: "Buka repo GitHub → Actions → Run workflow"
          }, { status: 429 });
        }
        throw launchErr;
      }

      await report(8, "browser", "Browser siap, membuka halaman...");
      const page = await browser.newPage();
      await report(12, "page", "Navigasi ke URL game...");

      // Collect network resources
      page.on("response", async (response) => {
        try {
          const req = response.request();
          const type = req.resourceType();
          if (!TYPES.has(type)) return;

          const u = response.url();
          if (seen.has(u) || isExcluded(u)) return;

          // data: / blob: — coba simpan binary lokal (offline-first)
          const isBlobOrData = u.startsWith("blob:") || u.startsWith("data:");
          if (isBlobOrData) {
            try {
              if (seen.has(u)) return;
              seen.add(u);
              let buffer = null;
              let ctBlob = response.headers()["content-type"] || "";
              if (u.startsWith("data:")) {
                const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(u);
                if (!m) return;
                ctBlob = m[1] || ctBlob || "application/octet-stream";
                const payload = m[3] || "";
                if (m[2]) {
                  const bin = atob(payload);
                  buffer = new Uint8Array(bin.length);
                  for (let i = 0; i < bin.length; i++) buffer[i] = bin.charCodeAt(i);
                } else {
                  buffer = new TextEncoder().encode(decodeURIComponent(payload));
                }
              } else {
                buffer = await response.body();
              }
              if (!buffer || !buffer.byteLength || buffer.byteLength > limSingle) return;
              if (sizeState.rawBytes + buffer.byteLength > limRaw) return;
              let ext = "bin";
              if (/png/i.test(ctBlob)) ext = "png";
              else if (/jpe?g/i.test(ctBlob)) ext = "jpg";
              else if (/webp/i.test(ctBlob)) ext = "webp";
              else if (/gif/i.test(ctBlob)) ext = "gif";
              else if (/json/i.test(ctBlob)) ext = "json";
              else if (/javascript/i.test(ctBlob)) ext = "js";
              else if (/css/i.test(ctBlob)) ext = "css";
              else if (/mp3|mpeg/i.test(ctBlob)) ext = "mp3";
              else if (/ogg/i.test(ctBlob)) ext = "ogg";
              const localPath = `assets/blob/${String(manifest.length + 1).padStart(4, "0")}-blob.${ext}`;
              zipFiles[localPath] = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
              sizeState.rawBytes += zipFiles[localPath].byteLength;
              manifest.push({
                url: u.slice(0, 200),
                type: type || "fetch",
                status: 200,
                localPath,
                size: zipFiles[localPath].byteLength,
                contentType: ctBlob,
                category: "game",
                classifyReason: u.startsWith("blob:") ? "blob-url" : "data-url",
                collectStatus: STRICT_STATUS.DOWNLOADED,
                strictStatus: STRICT_STATUS.ASSET
              });
            } catch (_) {}
            return;
          }

          // Gagal download: catat sebagai DOWNLOAD_FAILED — BUKAN API
          if (response.status() >= 400) {
            if (!seen.has(u)) {
              seen.add(u);
              const fail = markDownloadFailed(u, response.status(), "http " + response.status());
              manifest.push({
                url: u,
                type,
                status: response.status(),
                httpStatus: response.status(),
                localPath: null,
                size: 0,
                contentType: response.headers()["content-type"] || "",
                category: "game",
                classifyReason: fail.reason,
                collectStatus: STRICT_STATUS.DOWNLOAD_FAILED,
                strictStatus: STRICT_STATUS.DOWNLOAD_FAILED
              });
            }
            return;
          }
          seen.add(u);

          const buffer = await response.body();
          if (!buffer || buffer.byteLength === 0) return;

          // Guard: skip file terlalu besar (tanpa R2)
          if (buffer.byteLength > limSingle) {
            sizeState.skippedLarge++;
            return;
          }
          // Guard: stop menampung jika total raw sudah melewati batas
          if (sizeState.rawBytes + buffer.byteLength > limRaw) {
            sizeState.stoppedForSize = true;
            return;
          }

          const ct = response.headers()["content-type"] || "";
          let name = safe((new URL(u).pathname.split("/").pop() || "index").split("?")[0]);
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

          // Peek body text for JSON classification (lebih besar untuk API)
          let bodyPeek = "";
          try {
            const wantPeek = ct.includes("json") || ct.includes("text") || type === "xhr" || type === "fetch";
            if (wantPeek && buffer.byteLength < 800000) {
              const maxPeek = (type === "xhr" || type === "fetch" || ct.includes("json")) ? 120000 : 400;
              bodyPeek = new TextDecoder().decode(buffer.slice(0, Math.min(maxPeek, buffer.byteLength)));
            }
          } catch {}

          const classified = classifyResource(u, type, ct, bodyPeek);
          // TRACKING: buang sejak intercept — jangan simpan ke ZIP
          if (
            classified.status === "TRACKING" ||
            classified.reason === "tracking" ||
            (classified.category === "server" && /tracking/i.test(classified.reason || ""))
          ) {
            return;
          }

          const norm = normalizeResourceUrl(u);
          const pro = professionalFileName(u, type, ct, manifest.length);
          name = pro.name; // sudah include seq + nama profesional
          const isAssetCat = ["game", "script", "style", "data"].includes(classified.category);
          const slot = isAssetCat
            ? classifySlotSubfolder(u, type, ct)
            : { sub: null, reason: "" };
          let folder = folderOf(type, classified.category, slot.sub);
          const pref = preferredAssetDir(type, ct, norm.basename);
          if (pref && isAssetCat) folder = pref;

          // Selective filter — skip resource di luar include/exclude
          if (!shouldIncludeResource({
            category: classified.category,
            sub: slot.sub,
            folder,
            allowed: selectAllowed
          })) {
            return;
          }

          // name dari professionalFileName sudah 0001-role-hash.ext
          const localPath = name.startsWith(String(manifest.length + 1).padStart(4, "0"))
            ? `${folder}/${name}`
            : `${folder}/${String(manifest.length + 1).padStart(4, "0")}-${name}`;
          const r2Key = `${id}/${localPath}`;

          // Poin 4: semantik API
          let apiMeta = null;
          if (classified.category === "api" || type === "xhr" || type === "fetch") {
            try {
              apiMeta = classifyApiSemantics(u, type, ct, bodyPeek);
            } catch {}
          }

          if (env.COLLECTOR_BUCKET) {
            await env.COLLECTOR_BUCKET.put(r2Key, buffer, {
              httpMetadata: { contentType: ct || "application/octet-stream" }
            });
          }

          zipFiles[localPath] = new Uint8Array(buffer);
          try { runtimeBodies.set(u, new Uint8Array(buffer)); } catch (_) {}
          sizeState.rawBytes += buffer.byteLength;
          const entry = {
            url: u,
            urlClean: norm.cleanUrl || u.split("?")[0],
            type,
            status: response.status(),
            localPath,
            size: buffer.byteLength,
            contentType: ct,
            category: classified.category,
            subCategory: slot.sub || null,
            classifyReason: classified.reason + (slot.reason ? "+" + slot.reason : ""),
            collectStatus: STRICT_STATUS.DOWNLOADED,
            strictStatus: classified.status || STRICT_STATUS.ASSET,
            hadSignedQuery: !!norm.hadQuery
          };
          if (apiMeta) {
            entry.apiKind = apiMeta.kind;
            entry.apiConfidence = apiMeta.confidence;
            entry.apiFields = apiMeta.fields;
            entry.apiSignals = apiMeta.signals;
            entry.apiTopKeys = apiMeta.topKeys;
          }
          manifest.push(entry);
          // Live capture ticker (throttle progress updates)
          try {
            recentCapture.push({
              name: name.slice(0, 80),
              path: localPath,
              type,
              category: classified.category,
              size: buffer.byteLength,
              apiKind: apiMeta?.kind || null
            });
            if (recentCapture.length > 40) recentCapture.shift();
            const now = Date.now();
            if (now - lastCaptureReport > 700) {
              lastCaptureReport = now;
              const expectedHint = expectedRefs.size || null;
              report(
                Math.min(48, 12 + Math.floor(manifest.length / 3)),
                "capture",
                `Menangkap resource… ${manifest.length} file`,
                {
                  files: manifest.length,
                  recentFiles: recentCapture.slice(-18).reverse(),
                  schema: expectedHint
                    ? { expectedRefs: expectedHint, captured: manifest.length, gap: Math.max(0, expectedHint - manifest.length) }
                    : { captured: manifest.length }
                }
              ).catch(() => {});
            }
          } catch {}
        } catch {}
      });

      // Navigate
            // Navigate + catat status dokumen utama (struktur blokir)
      let mainDocStatus = 0;
      let mainDocUrl = target.href;
      try {
        const nav = await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 40000 });
        if (nav) {
          mainDocStatus = nav.status();
          mainDocUrl = nav.url() || target.href;
        }
      } catch (navErr) {
        // Coba sekali lagi tanpa hash fragment (kadang landing vs demo path)
        const bare = target.href.split("#")[0];
        if (bare && bare !== target.href) {
          const nav2 = await page.goto(bare, { waitUntil: "domcontentloaded", timeout: 40000 });
          if (nav2) {
            mainDocStatus = nav2.status();
            mainDocUrl = nav2.url() || bare;
          }
        } else {
          throw navErr;
        }
      }
      // Jika dokumen utama 401/403/451, tetap lanjut capture sebentar lalu quality gate yang menolak
      if (mainDocStatus >= 400) {
        await report(25, "blocked_doc", "Dokumen utama HTTP " + mainDocStatus + " — struktur diblokir", {
          files: manifest.length,
          mainDocStatus,
          mainDocUrl
        });
      }
      {
        const shot = await snap(page);
        await report(22, "loaded", "Halaman termuat, capture network...", { screenshot: shot, files: manifest.length });
      }

      // Tunggu sesuai wait_seconds (UI) kecuali user Stop
      if (!(await shouldStop())) {
        await report(24, "wait", "Menunggu network settle (" + waitSeconds + "s)...", { files: manifest.length });
        await page.waitForTimeout(Math.min(waitSeconds * 1000, ((typeof limits !== "undefined" && limits.maxWaitSec) || 120) * 1000));
      } else {
        await report(50, "stopping", "Stop — lanjut packing...", { files: manifest.length, stopRequested: true });
      }

      {
        const shot = await snap(page);
        await report(30, "interact", "Auto-click Play / Start...", { screenshot: shot, files: manifest.length });
      }

      // === Auto-click Play / Start / Mulai / Continue buttons ===
      try {
        await page.evaluate(async () => {
          const keywords = [
            "play", "start", "mulai", "continue", "lanjut", "main", "go", "enter",
            "tap to play", "click to play", "klik untuk main", "start game", "play now",
            "mulai game", "lanjutkan", "ok", "yes", "accept", "agree",
            "menu", "next", "lanjut", "close", "tutup", "skip", "demo", "loading",
            "tap", "press", "mulai bermain", "lets go", "let's go"
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
          for (const el of candidates.slice(0, 6)) {
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

      // Interaction Discovery (opsional) — spin/play hanya jika user minta auto_spins > 0
      if (autoSpins > 0 && !(await shouldStop())) {
        await report(36, "interaction", "Interaction Discovery: auto-spin x" + autoSpins + " (bukan syarat collect)...", {
          files: manifest.length
        });
        for (let i = 0; i < autoSpins; i++) {
          if (await shouldStop()) break;
          try {
            await page.evaluate(() => {
              const kws = ["spin", "putar", "play", "bet", "max bet", "auto"];
              const nodes = document.querySelectorAll("button, a, div, [role=button], .btn, [class*=spin], [id*=spin]");
              for (const el of nodes) {
                const t = ((el.textContent || "") + " " + (el.className || "") + " " + (el.id || "")).toLowerCase();
                if (kws.some(k => t.includes(k))) {
                  try { el.click(); return true; } catch (e) {}
                }
              }
              return false;
            });
            // iframe spins
            for (const frame of page.frames()) {
              if (frame === page.mainFrame()) continue;
              try {
                await frame.evaluate(() => {
                  const kws = ["spin", "putar", "play", "bet"];
                  document.querySelectorAll("button, a, div, [role=button]").forEach(el => {
                    const t = ((el.textContent || "") + " " + (el.className || "")).toLowerCase();
                    if (kws.some(k => t.includes(k))) try { el.click(); } catch (e) {}
                  });
                });
              } catch {}
            }
          } catch {}
          await page.waitForTimeout(spinDelayMs);
        }
      }

      if (await shouldStop()) {
        await report(50, "stopping", "Stop — skip scroll, packing...", { files: manifest.length, stopRequested: true });
      } else {
        {
          const shot = await snap(page);
          await report(42, "scroll", "Scroll & lazy-load asset...", { screenshot: shot, files: manifest.length });
        }
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
      }
      {
        const shot = await snap(page);
        await report(55, "html", "Ambil HTML + resource tertangkap...", { screenshot: shot, files: manifest.length });
      }

      // Ambil HTML
      let html = await page.content();
      zipFiles["index.html"] = strToU8(html);

      // Pass 2: scan referensi yang belum ter-download → auto-fetch yang kurang
      await report(62, "fill", "Auto-lengkapi (multi-pass)...", { files: manifest.length });
      let fillReport = { scanned: 0, missingFound: 0, fetched: 0, failed: 0, stillMissing: [], passes: 0 };
      try {
        fillReport = await fillMissingAssetsV2(
          zipFiles,
          manifest,
          seen,
          target.href,
          id,
          env,
          selectAllowed,
          {
            maxPerPass: Math.min(250, fillPerPass),
            maxPasses: Math.min(8, fillPasses)
          }
        );
        await report(
          68,
          "fill",
          "Fill selesai: +" +
            (fillReport.fetched || 0) +
            " file · dup " +
            (fillReport.duplicates || 0) +
            " · pass " +
            (fillReport.passes || 1) +
            " · sisa " +
            ((fillReport.stillMissing || []).length),
          { files: manifest.length }
        );
      } catch (e) {
        fillReport.error = String(e.message || e);
      }

      // Static re-scan + dependency queue (honest remaining)
      let staticReport = { urls: 0, swScripts: [], wasm: [] };
      let queueInfo = null;
      try {
        const st = staticAnalyzeZip(zipFiles, target.href);
        staticReport = {
          urls: (st.urls || []).length,
          swScripts: st.swScripts || [],
          wasm: st.wasm || []
        };
        // Enqueue SW / WASM / static URLs not yet seen
        for (const u of [...(st.urls || []), ...(st.swScripts || []), ...(st.wasm || [])]) {
          if (u && !seen.has(u)) {
            // leave for recovery/fill honesty via queue
          }
        }
        const q = buildDependencyQueue(zipFiles, seen, target.href, st.urls || []);
        queueInfo = queueReport(q.pending, seen, fillReport.fetched || 0, fillReport.failed || 0);
      } catch (e) {
        queueInfo = { error: String(e.message || e) };
      }

      // Recovery Engine — coba pulihkan stillMissing sebelum session resume
      let recoveryReport = { recovered: 0, failed: 0, stillMissing: [], methods: {} };
      try {
        const failedList = [
          ...(fillReport.stillMissing || []),
          ...((queueInfo && queueInfo.stillPending) || [])
        ];
        if (failedList.length) {
          await report(70, "recovery", "Recovery Engine: coba pulihkan asset gagal...", {
            files: manifest.length
          });
          const hashIndex = new Map();
          for (const [path, data] of Object.entries(zipFiles || {})) {
            if (!data || typeof data === "string") continue;
            try {
              const h = sha256(data instanceof Uint8Array ? data : new Uint8Array(data));
              if (h && !hashIndex.has(h)) hashIndex.set(h, path);
            } catch (_) {}
          }
          recoveryReport = await runRecoveryEngine(failedList, {
            seen,
            zipFiles,
            manifest,
            baseHref: target.href,
            runtimeBodies,
            hashIndex,
            maxRecover: 50
          });
          // stillMissing jujur = recovery sisa
          fillReport.stillMissing = recoveryReport.stillMissing || [];
          await report(
            71,
            "recovery",
            "Recovery: +" +
              (recoveryReport.recovered || 0) +
              " · gagal " +
              (recoveryReport.failed || 0) +
              " · sisa " +
              ((recoveryReport.stillMissing || []).length),
            { files: manifest.length }
          );
        }
      } catch (e) {
        recoveryReport.error = String(e.message || e);
      }

      // Simpan session resume jika masih ada missing (A.6)
      let resumeSessionId = null;
      try {
        if (hasKV(env) && (fillReport.stillMissing || []).length > 0) {
          const saved = await saveSession(env, {
            id,
            url: target.href,
            phase: "post-fill",
            seen: [...seen],
            stillMissing: fillReport.stillMissing,
            totals: { files: manifest.length },
            note: "auto after fillMissingAssets"
          });
          resumeSessionId = saved.id;
        }
      } catch {}

      await report(72, "rewrite", "Smart path rewrite + frame-buster...", { files: manifest.length });
      // Smart offline packaging: path rewrite (signed URL → lokal) + frame-buster
      let smart = smartPackage(zipFiles, manifest);
      // Pass 2 rewrite if recovery menambah file baru
      if (recoveryReport && recoveryReport.recovered > 0) {
        const smart2 = smartPackage(zipFiles, manifest);
        smart = {
          ...smart,
          rewritten: (smart.rewritten || 0) + (smart2.rewritten || 0),
          urlHits: (smart.urlHits || 0) + (smart2.urlHits || 0),
          neutralized: (smart.neutralized || 0) + (smart2.neutralized || 0),
          recoveryRewritePass: true
        };
      }

      // Opsi 2 HYBRID: hapus tracking, download signed CDN → assets/eajzz/, rewrite
      let hybridReport = null;
      try {
        await report(74, "hybrid", "Hybrid CDN fix (tracking off + lokal asset)...", { files: manifest.length });
        hybridReport = await applyHybridCdnFix(zipFiles, manifest, {
          baseUrl: target.href,
          assetDir: "assets/eajzz"
        });
        // Rewrite lagi setelah file baru masuk
        if (hybridReport.downloaded > 0) {
          const smart3 = smartPackage(zipFiles, manifest);
          smart = {
            ...smart,
            rewritten: (smart.rewritten || 0) + (smart3.rewritten || 0),
            urlHits: (smart.urlHits || 0) + (smart3.urlHits || 0),
            hybridDownloaded: hybridReport.downloaded,
            trackingRemoved: hybridReport.trackingRemoved
          };
        } else {
          smart.hybridDownloaded = hybridReport.downloaded || 0;
          smart.trackingRemoved = hybridReport.trackingRemoved || 0;
        }
        zipFiles["hybrid-fix.json"] = strToU8(JSON.stringify(hybridReport, null, 2));
        await report(
          75,
          "hybrid",
          "Hybrid: +" + (hybridReport.downloaded || 0) + " CDN · tracking -" + (hybridReport.trackingRemoved || 0) + " · fail " + ((hybridReport.failed || []).length),
          { files: Object.keys(zipFiles).length }
        );
      } catch (e) {
        hybridReport = { error: String(e.message || e) };
      }

      // Post-collect audit: http(s) tersisa → unresolved asset ≠ API
      let collectAudit = null;
      try {
        await report(76, "audit", "Post-collect scan URL eksternal...", { files: manifest.length });
        collectAudit = postCollectAudit(zipFiles, manifest, seen, target.href);
        zipFiles["collect-audit.json"] = strToU8(JSON.stringify(collectAudit, null, 2));
        await report(
          78,
          "audit",
          "Audit: https-asset " +
            (collectAudit.httpsAssetRemaining ?? collectAudit.byStatus?.unresolvedAssets ?? 0) +
            (collectAudit.offlineAssetReady || collectAudit.ok ? " (OK=0)" : "") +
            " · API " +
            (collectAudit.byStatus?.apis || 0) +
            " · fail " +
            (collectAudit.byStatus?.downloadFailed || 0),
          { files: manifest.length }
        );
      } catch (e) {
        collectAudit = { error: String(e.message || e) };
      }

      await report(80, "analyze", "Analisis slot (symbols/paytable/audio/engine)...", { files: manifest.length });
      // Poin 2+3: analisis isi JSON/config + deteksi engine
      let analysis = null;
      try {
        let htmlForDetect = "";
        try {
          if (zipFiles["index.html"]) {
            htmlForDetect = new TextDecoder().decode(zipFiles["index.html"]).slice(0, 100_000);
          }
        } catch {}
        analysis = analyzeGameContent(zipFiles, manifest, htmlForDetect);
      } catch (e) {
        analysis = { error: String(e.message || e), summary: {} };
      }

      // Dependency Analyzer + Path Resolver
      let deps = null;
      try {
        deps = analyzeDependencies(zipFiles, manifest);
        if (analysis && typeof analysis === "object") {
          analysis.dependencies = deps;
          if (analysis.summary) {
            analysis.summary.depScore = deps.score;
            analysis.summary.depResolved = deps.resolved;
            analysis.summary.depMissing = deps.missing;
            analysis.summary.depExternal = deps.external;
          }
          if (analysis.scores) {
            analysis.scores.dependencies = {
              score: deps.score,
              found: deps.resolved,
              missing: deps.missing,
              label: "Dependencies resolved",
              ok: deps.score >= 70
            };
            // recompute overall lightly
            const vals = Object.values(analysis.scores)
              .filter((s) => s && typeof s.score === "number")
              .map((s) => s.score);
            if (vals.length) {
              analysis.scores.overall = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
            }
          }
        }
      } catch (e) {
        deps = { error: String(e.message || e) };
      }

      // Mapping relasi asset (symbol ↔ atlas ↔ audio)
      let relations = null;
      try {
        relations = mapAssetRelations(analysis, zipFiles, deps);
        if (analysis && typeof analysis === "object") {
          analysis.relations = relations;
          if (analysis.summary) {
            analysis.summary.relationScore = relations.stats?.score;
            analysis.summary.symbolsLinked = relations.stats?.linked;
          }
          if (analysis.scores) {
            analysis.scores.relations = {
              score: relations.stats?.score || 0,
              found: relations.stats?.linked || 0,
              unmatched: relations.stats?.unmatched || 0,
              label: "Asset relations",
              ok: (relations.stats?.linked || 0) > 0
            };
            const vals = Object.values(analysis.scores)
              .filter((s) => s && typeof s.score === "number")
              .map((s) => s.score);
            if (vals.length) {
              analysis.scores.overall = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
            }
          }
        }
      } catch (e) {
        relations = { error: String(e.message || e) };
      }

      // Engine-specific path patches (server-side, setelah deteksi engine)
      try {
        const engInfo = detectEngineFromAnalysis(analysis, zipFiles);
        let engFixCount = 0;
        for (const [path, data] of Object.entries(zipFiles)) {
          if (!/\.(html?|js|mjs)$/i.test(path) && path !== "index.html") continue;
          if (!data || data.byteLength > 1_500_000) continue;
          let t;
          try { t = new TextDecoder().decode(data); } catch { continue; }
          const er = applyEngineRepairs(t, engInfo.engine, path);
          if (er.fixes.length) {
            zipFiles[path] = strToU8(er.text);
            engFixCount += er.fixes.length;
          }
        }
        if (smart) {
          smart.engine = engInfo.engine;
          smart.engineFixes = engFixCount;
        }
      } catch {}

      // Keterangan + pemisahan game vs API/server
      const ket = buildKeterangan(target.href, manifest, smart, analysis);
      const gameCount = manifest.filter(r => ["game", "script", "style", "data"].includes(r.category)).length;
      const apiCount = manifest.filter(r => r.category === "api").length;
      const serverCount = manifest.filter(r => r.category === "server").length;
      const byCat = {
        game: manifest.filter(r => r.category === "game").length,
        script: manifest.filter(r => r.category === "script").length,
        style: manifest.filter(r => r.category === "style").length,
        data: manifest.filter(r => r.category === "data").length,
        api: apiCount,
        server: serverCount
      };

      const failCount = manifest.filter(
        (r) => r.collectStatus === STRICT_STATUS.DOWNLOAD_FAILED || r.strictStatus === STRICT_STATUS.DOWNLOAD_FAILED
      ).length;
      const manifestData = {
        target: target.href,
        collectedAt: new Date().toISOString(),
        totalFiles: manifest.length,
        totals: {
          game: gameCount,
          byCategory: byCat,
          api: apiCount,
          server: serverCount,
          downloadFailed: failCount
        },
        smartRewrite: smart,
        autoFill: fillReport,
        collectAudit: collectAudit
          ? {
              ok: collectAudit.ok,
              byStatus: collectAudit.byStatus,
              unresolvedSample: (collectAudit.unresolvedAssets || []).slice(0, 20)
            }
          : null,
        analysisSummary: analysis?.summary || null,
        note:
          "Klasifikasi: Content-Type dulu (CDN+image=ASSET). DOWNLOAD_FAILED ≠ API. Spin=Interaction Discovery opsional. Lihat collect-audit.json.",
        resources: manifest
      };
      zipFiles["manifest.json"] = strToU8(JSON.stringify(manifestData, null, 2));
      zipFiles["keterangan.json"] = strToU8(JSON.stringify(ket.json, null, 2));
      // api-map.json — peta endpoint + snapshot untuk Sandbox mock (Sprint process 2)
      let apiMapFinal = null;
      try {
        let apiMap = buildApiMap(manifest, zipFiles);
        apiMap = ensureCriticalApiMocks(apiMap);
        apiMapFinal = apiMap;
        zipFiles["api-map.json"] = strToU8(JSON.stringify(apiMap, null, 2));
      } catch (e) {
        apiMapFinal = ensureCriticalApiMocks({
          version: 2,
          error: String(e && e.message || e),
          endpoints: []
        });
        zipFiles["api-map.json"] = strToU8(JSON.stringify(apiMapFinal, null, 2));
      }

      // Offline Super Engine — skor + bootstrap di index.html
      try {
        const superRep = buildOfflineSuperReport({
          zipFiles,
          manifest,
          apiMap: apiMapFinal,
          hybrid: hybridReport,
          collectAudit
        });
        zipFiles["offline-super.json"] = strToU8(JSON.stringify(superRep, null, 2));
        if (zipFiles["index.html"]) {
          try {
            let html = new TextDecoder().decode(zipFiles["index.html"]);
            html = injectOfflineBootstrap(html, superRep);
            zipFiles["index.html"] = strToU8(html);
          } catch (_) {}
        }
      } catch (e) {
        zipFiles["offline-super.json"] = strToU8(JSON.stringify({
          error: String(e && e.message || e),
          version: 2
        }, null, 2));
      }
      zipFiles["KETERANGAN.md"] = strToU8(ket.md);
      zipFiles["analisis.json"] = strToU8(JSON.stringify(analysis, null, 2));
      if (deps) zipFiles["dependency.json"] = strToU8(JSON.stringify(deps, null, 2));
      if (relations) zipFiles["relations.json"] = strToU8(JSON.stringify(relations, null, 2));
            // URL map + status report (ultimate collector report engine)
      try {
        const urlMapBuilt = buildUrlMap(manifest);
        zipFiles["url-map.json"] = strToU8(JSON.stringify(urlMapBuilt, null, 2));
        const statusReport = formatStatusReport({
          fillReport,
          recoveryReport,
          queueInfo,
          audit: typeof collectAudit !== "undefined" ? collectAudit : null,
          urlMap: urlMapBuilt
        });
        statusReport.static = staticReport;
        statusReport.mode = typeof collectMode !== "undefined" ? collectMode : "full";
        zipFiles["collect-status.json"] = strToU8(JSON.stringify(statusReport, null, 2));
      } catch (e) {
        try {
          zipFiles["collect-status.json"] = strToU8(JSON.stringify({ error: String(e.message || e) }));
        } catch (_) {}
      }

zipFiles["kelengkapan.json"] = strToU8(JSON.stringify({
        autoFill: fillReport,
        summary: {
          referencedMissing: fillReport.missingFound,
          autoDownloaded: fillReport.fetched,
          failedOrSkipped: (fillReport.stillMissing || []).length,
          note: fillReport.fetched
            ? "Beberapa file yang kurang berhasil dilengkapi otomatis sebelum ZIP dibuat."
            : "Tidak ada file tambahan yang berhasil di-fetch, atau semua referensi sudah lengkap."
        },
        stillMissing: fillReport.stillMissing || [],
        // Skor kelengkapan per kategori slot (dari analyzeGameContent)
        scores: analysis?.scores || null,
        categories: {
          symbols: {
            ok: !!(analysis?.scores?.symbols?.ok),
            count: analysis?.summary?.symbolCount ?? 0,
            samples: (analysis?.symbols || []).slice(0, 20)
          },
          paytable: {
            ok: !!(analysis?.scores?.paytable?.ok),
            count: analysis?.summary?.paytableHits ?? 0
          },
          audioEvents: {
            ok: !!(analysis?.scores?.audio?.ok),
            count: analysis?.summary?.audioEventCount ?? 0,
            byEvent: analysis?.summary?.audioByEvent || {},
            mapped: analysis?.scores?.audio?.mapped ?? 0
          },
          atlasSpine: {
            ok: !!(analysis?.scores?.atlasSpine?.ok),
            atlas: analysis?.summary?.atlasCount ?? 0,
            spine: analysis?.summary?.spineCount ?? 0
          },
          features: {
            ok: !!(analysis?.scores?.features?.ok),
            count: analysis?.summary?.featureHits ?? 0
          },
          engine: {
            ok: !!(analysis?.scores?.engine?.ok),
            name: analysis?.summary?.engine || "unknown",
            confidence: analysis?.summary?.engineConfidence || "none"
          }
        },
        overallScore: analysis?.scores?.overall ?? null,
        dependencies: deps && !deps.error ? {
          score: deps.score,
          resolved: deps.resolved,
          missing: deps.missing,
          external: deps.external,
          missingUnique: deps.missingUnique,
          topMissingFiles: deps.topMissingFiles
        } : (deps || null),
        relations: relations && !relations.error ? {
          score: relations.stats?.score,
          linked: relations.stats?.linked,
          unmatched: relations.stats?.unmatched,
          featureAudio: relations.featureAudio,
          sample: (relations.symbolRelations || []).slice(0, 15)
        } : (relations || null)
      }, null, 2));

      zipFiles["README.md"] = strToU8(`# Game Resource Package (Game Collector Pro)
Target: ${target.href}
Tanggal: ${new Date().toISOString()}
Total: ${manifest.length} file (game: ${gameCount} · api: ${apiCount} · server: ${serverCount} · downloadFailed: ${failCount})
Smart rewrite: ${smart.rewritten} · frame-buster: ${smart.neutralized}
Engine: ${analysis?.engine?.engine ?? "unknown"} (${analysis?.engine?.confidence ?? "none"})
Analisis: paytable=${analysis?.summary?.paytableHits ?? 0} · symbols=${analysis?.summary?.symbolCount ?? 0} · features=${analysis?.summary?.featureHits ?? 0} · atlas=${analysis?.summary?.atlasCount ?? 0}
Collect audit OK: ${collectAudit && collectAudit.ok ? "YES" : "NO / partial"} · unresolved assets: ${collectAudit?.byStatus?.unresolvedAssets ?? "?"}

## Klasifikasi
- Content-Type & ekstensi → **ASSET** (CDN image/audio = asset, bukan API)
- Path session/spin/balance → **API** (terpisah di server/)
- HTTP gagal → **DOWNLOAD_FAILED** (bukan API)
- Auto-spin = Interaction Discovery opsional (default off)

## Pemisahan otomatis
- \`assets/\` — asset game (symbols, reels, ui, audio, config, ...)
- \`server/api/\` — snapshot response API
- \`collect-audit.json\` — post-collect scan http(s) tersisa
- \`api-map.json\` · \`analisis.json\` · \`KETERANGAN.md\`

${formatCollectAuditSummary(collectAudit)}

## Cara pakai
1. Baca **collect-audit.json** + **KETERANGAN.md**
2. Load ZIP di Workspace → Scan Error / AI Repair / Sandbox
3. Hybrid jika API masih butuh server live

> API di folder server/ hanya snapshot saat collect, bukan backend live.
`);

      await browser.close();
      browser = null;

      // Hitung ukuran raw (masih di memory)
      const rawTotal = sumZipFilesBytes(zipFiles);
      const hasR2 = Boolean(env.COLLECTOR_BUCKET);

      // Guard raw total — hanya hard-fail jika TIDAK ada R2
      // (dengan R2 kita tetap coba packaging, memory tetap batas praktis ~50-60MB)
      if (!hasR2 && rawTotal > MAX_RAW_TOTAL * 1.15) {
        return tooLargeResponse({
          id,
          totalFiles: manifest.length,
          rawBytes: rawTotal,
          skippedLargeFiles: sizeState.skippedLarge,
          stoppedForSize: sizeState.stoppedForSize
        });
      }

      // Buat ZIP (level 7: lebih kecil, sedikit lebih CPU)
      await report(90, "zip", "Packaging ZIP...", { files: manifest.length });
      const zipData = zipSync(zipFiles, { level: 7 });
      const zipKey = `${id}/game-package.zip`;

      // Simpan ke R2 jika bucket sudah di-bind (selalu, baik kecil maupun besar)
      if (hasR2) {
        try {
          await env.COLLECTOR_BUCKET.put(zipKey, zipData, {
            httpMetadata: {
              contentType: "application/zip",
              contentDisposition: `attachment; filename="game-package-${id}.zip"`
            }
          });
        } catch (r2err) {
          console.error("R2 put failed:", r2err);
          // Lanjut; kalau ZIP kecil tetap bisa kirim binary
        }
      }

      // History server-side (KV) jika tersedia
      try {
        if (hasKV(env)) {
          await putHistory(env, {
            id,
            url: target.href,
            status: (fillReport.stillMissing || []).length ? "ok_partial" : "ok",
            files: manifest.length,
            zipSize: zipData.byteLength,
            totals: { game: gameCount, api: apiCount, server: serverCount },
            overallScore: analysis?.scores?.overall ?? null,
            stillMissing: (fillReport.stillMissing || []).slice(0, 30),
            message: resumeSessionId ? `session ${resumeSessionId}` : null,
            via: hasR2 && zipData.byteLength > MAX_ZIP_RESPONSE ? "r2" : "worker"
          });
        }
      } catch {}


      // QUALITY_GATE_APPLIED — jangan klaim sukses jika paket kosong / halaman diblokir
      const quality = detectCollectFailure(html, manifest, gameCount, typeof mainDocStatus === "number" ? mainDocStatus : 0);
      if (quality.failed) {
        try {
          zipFiles["COLLECT_FAILED.json"] = strToU8(JSON.stringify({
            ok: false,
            reason: quality.reason,
            message: quality.message,
            target: target.href,
            files: manifest.length,
            gameFiles: gameCount,
            apiFiles: apiCount,
            serverFiles: serverCount,
            at: new Date().toISOString()
          }, null, 2));
        } catch {}
        await report(100, "failed", quality.message || "Collect gagal (paket tidak usable)", {
          files: manifest.length,
          done: true,
          failed: true,
          reason: quality.reason
        });
        try {
          if (hasKV(env)) {
            await putHistory(env, {
              id,
              url: target.href,
              status: quality.reason === "TARGET_BLOCKED" ? "blocked" : "empty",
              files: manifest.length,
              zipSize: 0,
              totals: { game: gameCount, api: apiCount, server: serverCount },
              message: quality.message
            });
          }
        } catch {}
        try { if (browser) await browser.close(); } catch {}
        return Response.json(
          {
            ok: false,
            error: quality.reason,
            code: quality.reason,
            message: quality.message,
            id,
            files: manifest.length,
            gameFiles: gameCount,
            apiFiles: apiCount,
            serverFiles: serverCount,
            suggest: quality.reason === "TARGET_BLOCKED"
              ? "Situs menolak bot/datacenter. Coba Collect via GitHub (IP beda) atau target yang tidak memblokir. Offline penuh tidak dijamin untuk slot server-side."
              : "Tidak ada asset game. Pastikan URL langsung ke halaman game (bukan landing) dan tunggu resource termuat."
          },
          {
            status: 422,
            headers: {
              "X-GC-Ok": "0",
              "X-GC-Error": quality.reason,
              "X-GC-Id": id,
              "X-GC-Files": String(manifest.length),
              "X-GC-Game-Files": String(gameCount),
              "X-GC-Api-Files": String(apiCount),
              "X-GC-Server-Files": String(serverCount),
              "X-GC-Message": quality.message || "Collect gagal"
            }
          }
        );
      }

      // Kelengkapan vs skema (referensi di HTML/JS + stillMissing fill)
      const stillN = (fillReport.stillMissing || []).length;
      const missingFound = fillReport.missingFound || 0;
      const overallScore = analysis?.scores?.overall;
      const incomplete =
        stillN > 0 ||
        (missingFound > 0 && (fillReport.fetched || 0) < missingFound) ||
        (typeof overallScore === "number" && overallScore < 55) ||
        gameCount === 0;
      const suggestions = [];
      if (stillN > 0) {
        suggestions.push("Jalankan Resume missing untuk fetch sisa referensi (" + stillN + " URL).");
      }
      if (gameCount < 5) {
        suggestions.push("Capture ulang dengan Collect via GitHub (auto_spins=6, wait=22) agar session/spin + CDN ikut tertangkap.");
      }
      if ((apiCount || 0) === 0) {
        suggestions.push("Belum ada response API. Aktifkan Auto Spin / klik Spin di game lalu collect lagi.");
      }
      if (typeof overallScore === "number" && overallScore < 70) {
        suggestions.push("Skor kelengkapan " + overallScore + "/100 — cek panel Workspace → kelengkapan (symbols/paytable/audio).");
      }
      if (!incomplete) {
        suggestions.push("Paket cukup lengkap. Load ZIP di Workspace → Preview Hybrid.");
      }
      const completeness = {
        incomplete: Boolean(incomplete),
        overallScore: overallScore ?? null,
        expectedRefs: missingFound + manifest.length,
        captured: manifest.length,
        stillMissing: stillN,
        fillFound: missingFound,
        fillOk: fillReport.fetched || 0,
        game: gameCount,
        api: apiCount,
        server: serverCount
      };
      await report(100, incomplete ? "done_incomplete" : "done", incomplete ? "Selesai — ada file kurang" : "Selesai", {
        files: manifest.length,
        done: true,
        recentFiles: recentCapture.slice(-20).reverse(),
        completeness,
        suggestions,
        schema: {
          expectedFromRefs: missingFound,
          captured: manifest.length,
          gap: stillN
        }
      });

      const commonHeaders = {
        "X-GC-Ok": "1",
        "X-GC-Incomplete": incomplete ? "1" : "0",
        "X-GC-Id": id,
        "X-GC-Progress-Id": progressId,
        "X-GC-Session-Id": resumeSessionId || "",
        "X-GC-Still-Missing": String(stillN),
        "X-GC-Files": String(manifest.length),
        "X-GC-Overall-Score": overallScore != null ? String(overallScore) : "",
        "X-GC-Zip-Size": String(zipData.byteLength),
        "X-GC-Raw-Bytes": String(rawTotal),
        "X-GC-Smart-Rewritten": String(smart.rewritten || 0),
        "X-GC-Smart-Neutralized": String(smart.neutralized || 0),
        "X-GC-Game-Files": String(gameCount),
        "X-GC-Api-Files": String(apiCount),
        "X-GC-Server-Files": String(serverCount),
        "X-GC-Fill-Found": String(fillReport.missingFound || 0),
        "X-GC-Fill-Ok": String(fillReport.fetched || 0),
        "X-GC-Fill-Fail": String(fillReport.failed || 0),
        "X-GC-Engine": String(analysis?.engine?.engine || "unknown"),
        "X-GC-Engine-Confidence": String(analysis?.engine?.confidence || "none"),
        "X-GC-Skipped-Large": String(sizeState.skippedLarge || 0),
        "X-GC-Size-Capped": sizeState.stoppedForSize ? "1" : "0",
        "X-GC-Select-Include": rawInclude.length ? rawInclude.join(",") : "*",
        "X-GC-Select-Exclude": rawExclude.length ? rawExclude.join(",") : ""
      };

      // ZIP terlalu besar untuk response Worker → pakai R2 (Poin 1)
      if (zipData.byteLength > MAX_ZIP_RESPONSE) {
        if (hasR2) {
          const downloadUrl = `/api/r2/download?key=${encodeURIComponent(zipKey)}`;
          return Response.json(
            {
              ok: true,
              via: "r2",
              id,
              downloadUrl,
              zipSize: zipData.byteLength,
              files: manifest.length,
              gameFiles: gameCount,
              apiFiles: apiCount,
              serverFiles: serverCount,
              stillMissing: (fillReport.stillMissing || []).length,
              engine: analysis?.engine?.engine || "unknown",
              message: `Capture berhasil via R2. ZIP ${(zipData.byteLength / 1024 / 1024).toFixed(1)} MB · game ${gameCount} · api ${apiCount}.`
            },
            {
              status: 200,
              headers: {
                ...commonHeaders,
                "X-GC-Via": "r2",
                "X-GC-Download-Url": downloadUrl,
                "X-GC-Message": `Capture berhasil via R2. ZIP ${(zipData.byteLength / 1024 / 1024).toFixed(1)} MB.`
              }
            }
          );
        }
        // Tidak ada R2 → fallback lama (GitHub Actions)
        return tooLargeResponse({
          id,
          totalFiles: manifest.length,
          rawBytes: rawTotal,
          zipBytes: zipData.byteLength,
          skippedLargeFiles: sizeState.skippedLarge,
          stoppedForSize: sizeState.stoppedForSize
        });
      }

      // ZIP kecil/sedang → kirim binary langsung (jalur Worker)
      return new Response(zipData, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="game-package-${id}.zip"`,
          ...commonHeaders,
          "X-GC-Via": hasR2 ? "worker+r2" : "worker",
          "X-GC-Message": `Capture berhasil. ZIP ${Math.round(zipData.byteLength / 1024)} KB · game ${gameCount} · api ${apiCount} · engine ${analysis?.engine?.engine || "unknown"}.`
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

