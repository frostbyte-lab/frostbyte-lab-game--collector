/**
 * Game Collector Pro — Worker entry (modular Poin 5)
 */
import { launch } from "@cloudflare/playwright";
import { zipSync, strToU8 } from "fflate";

import { safe } from "./lib/safe.js";
import { TYPES, isExcluded, classifyResource } from "./classify/resource.js";
import { classifySlotSubfolder, folderOf } from "./classify/slot-folder.js";
import { classifyApiSemantics } from "./classify/api-semantics.js";
import { buildKeterangan } from "./package/keterangan.js";
import { smartPackage } from "./package/smart-rewrite.js";
import { analyzeGameContent } from "./analyze/content.js";
import { analyzeDependencies } from "./analyze/dependency.js";
import { fillMissingAssets } from "./collect/fill-missing.js";
import { ghFetch } from "./collect/github.js";
import {
  MAX_SINGLE_FILE,
  MAX_RAW_TOTAL,
  MAX_ZIP_RESPONSE,
  tooLargeResponse,
  sumZipFilesBytes
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
import {
  hasProgressStore,
  setProgress,
  getProgress,
  requestStop,
  isStopRequested,
  clearStop
} from "./progress/store.js";

const GH_OWNER = "frostbyte-lab";
const GH_REPO = "frostbyte-lab-game--collector";
const GH_WORKFLOW = "collect.yml";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health
    if (request.method === "GET" && url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "game-collector-pro",
        version: "4.3-r2",
        github: Boolean(env.GITHUB_TOKEN),
        limits: {
          mode: env.COLLECTOR_BUCKET
            ? "worker + r2-large + github-actions-fallback"
            : "worker-small + github-actions-large",
          maxSingleFileMB: Math.round(MAX_SINGLE_FILE / 1024 / 1024),
          maxRawTotalMB: Math.round(MAX_RAW_TOTAL / 1024 / 1024),
          maxZipResponseMB: Math.round(MAX_ZIP_RESPONSE / 1024 / 1024),
          r2: Boolean(env.COLLECTOR_BUCKET),
          historyKV: hasKV(env),
          progressKV: hasProgressStore(env)
        }
      });
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

      // Detail job + steps (apa yang sedang dijalankan)
      let jobsOut = [];
      let currentStep = null;
      try {
        const jobs = await ghFetch(env, `/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}/jobs`);
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
        const arts = await ghFetch(env, `/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}/artifacts`);
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
        Math.min(80, Number(body.maxFetch) || 40)
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
          if (u.startsWith("data:") || u.startsWith("blob:")) return;
          seen.add(u);

          if (response.status() >= 400) return;

          const buffer = await response.body();
          if (!buffer || buffer.byteLength === 0) return;

          // Guard: skip file terlalu besar (tanpa R2)
          if (buffer.byteLength > MAX_SINGLE_FILE) {
            sizeState.skippedLarge++;
            return;
          }
          // Guard: stop menampung jika total raw sudah melewati batas
          if (sizeState.rawBytes + buffer.byteLength > MAX_RAW_TOTAL) {
            sizeState.stoppedForSize = true;
            return;
          }

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
          const slot = classified.category === "game"
            ? classifySlotSubfolder(u, type, ct)
            : { sub: null, reason: "" };
          const folder = folderOf(type, classified.category, slot.sub);
          const localPath = `${folder}/${String(manifest.length + 1).padStart(4, "0")}-${name}`;
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
          sizeState.rawBytes += buffer.byteLength;
          const entry = {
            url: u,
            type,
            status: response.status(),
            localPath,
            size: buffer.byteLength,
            contentType: ct,
            category: classified.category,
            subCategory: slot.sub || null,
            classifyReason: classified.reason + (slot.reason ? "+" + slot.reason : "")
          };
          if (apiMeta) {
            entry.apiKind = apiMeta.kind;
            entry.apiConfidence = apiMeta.confidence;
            entry.apiFields = apiMeta.fields;
            entry.apiSignals = apiMeta.signals;
            entry.apiTopKeys = apiMeta.topKeys;
          }
          manifest.push(entry);
        } catch {}
      });

      // Navigate
      await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 40000 });
      {
        const shot = await snap(page);
        await report(22, "loaded", "Halaman termuat, capture network...", { screenshot: shot, files: manifest.length });
      }

      // Tunggu sebentar kecuali user sudah Stop
      if (!(await shouldStop())) {
        await page.waitForTimeout(3000);
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
      await report(62, "fill", "Auto-lengkapi file yang kurang...", { files: manifest.length });
      let fillReport = { scanned: 0, missingFound: 0, fetched: 0, failed: 0, stillMissing: [] };
      try {
        fillReport = await fillMissingAssets(zipFiles, manifest, seen, target.href, id, env);
      } catch (e) {
        fillReport.error = String(e.message || e);
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
      // Smart offline packaging: path rewrite + frame-buster neutralize
      const smart = smartPackage(zipFiles, manifest);

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
      const gameCount = manifest.filter(r => r.category === "game").length;
      const apiCount = manifest.filter(r => r.category === "api").length;
      const serverCount = manifest.filter(r => r.category === "server").length;

      const manifestData = {
        target: target.href,
        collectedAt: new Date().toISOString(),
        totalFiles: manifest.length,
        totals: { game: gameCount, api: apiCount, server: serverCount },
        smartRewrite: smart,
        autoFill: fillReport,
        analysisSummary: analysis?.summary || null,
        note: "Asset game di assets/ (sub-folder slot). API/server di server/. Lihat KETERANGAN.md + analisis.json.",
        resources: manifest
      };
      zipFiles["manifest.json"] = strToU8(JSON.stringify(manifestData, null, 2));
      zipFiles["keterangan.json"] = strToU8(JSON.stringify(ket.json, null, 2));
      zipFiles["KETERANGAN.md"] = strToU8(ket.md);
      zipFiles["analisis.json"] = strToU8(JSON.stringify(analysis, null, 2));
      if (deps) zipFiles["dependency.json"] = strToU8(JSON.stringify(deps, null, 2));
      if (relations) zipFiles["relations.json"] = strToU8(JSON.stringify(relations, null, 2));
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
Total: ${manifest.length} file (game: ${gameCount} · api: ${apiCount} · server: ${serverCount})
Smart rewrite: ${smart.rewritten} · frame-buster: ${smart.neutralized}
Engine: ${analysis?.engine?.engine ?? "unknown"} (${analysis?.engine?.confidence ?? "none"})
Analisis: paytable=${analysis?.summary?.paytableHits ?? 0} · symbols=${analysis?.summary?.symbolCount ?? 0} · features=${analysis?.summary?.featureHits ?? 0} · atlas=${analysis?.summary?.atlasCount ?? 0}

## Pemisahan otomatis
- \`assets/\` — asset game (symbols, reels, ui, audio, config, ...)
- \`server/api/\` — snapshot response API (terpisah dari game)
- \`analisis.json\` — hasil parsing paytable / symbol / feature / atlas (Poin 2)
- \`KETERANGAN.md\` — deskripsi host, endpoint, kategori + sub-folder

## Cara pakai
1. Baca **KETERANGAN.md** dan **analisis.json** dulu
2. Extract ZIP → \`npx serve .\` atau load di Workspace Game Collector Pro
3. Preview / Auto Repair / Online Hybrid

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

      await report(100, "done", "Selesai", { files: manifest.length, done: true });

      const commonHeaders = {
        "X-GC-Ok": "1",
        "X-GC-Id": id,
        "X-GC-Progress-Id": progressId,
        "X-GC-Session-Id": resumeSessionId || "",
        "X-GC-Still-Missing": String((fillReport.stillMissing || []).length),
        "X-GC-Files": String(manifest.length),
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
        "X-GC-Size-Capped": sizeState.stoppedForSize ? "1" : "0"
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

