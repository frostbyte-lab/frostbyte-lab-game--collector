/**
 * Upload paket game (ZIP files map) ke repo Edu-network via GitHub Git Trees API.
 * Target path: game-{N}/... di branch main → Cloudflare Pages auto-deploy.
 * Auto-patch API base + inject SDK sebelum commit.
 *
 * Binary blob dipecah multi-invocation (KV session) agar tidak kena
 * "Too many subrequests by single Worker invocation".
 */
import { ghFetch } from "../collect/github.js";
import { patchFilesForEdu } from "./edu-patch.js";

const DEFAULT_EDU = {
  owner: "frostbyte-lab",
  repo: "Edu-network",
  branch: "main",
  baseUrl: "https://ea29118c.edu-network.pages.dev"
};

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 400;
/** Max GitHub blob subrequests per Worker invocation (sisakan headroom utk tree/commit/ref) */
const MAX_BLOB_PER_INVOKE = 25;
const SESSION_TTL = 900;
const TEXT_RE = /\.(html?|js|mjs|cjs|json|css|txt|svg|xml|map|md|csv|tsv|vtt|glsl|vert|frag)$/i;

function eduConfig(env = {}) {
  return {
    owner: env.EDU_GH_OWNER || DEFAULT_EDU.owner,
    repo: env.EDU_GH_REPO || DEFAULT_EDU.repo,
    branch: env.EDU_GH_BRANCH || DEFAULT_EDU.branch,
    baseUrl: (env.EDU_PAGES_URL || DEFAULT_EDU.baseUrl).replace(/\/$/, "")
  };
}

function normalizeGamePath(rawPath) {
  let p = String(rawPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
  if (!p || p.endsWith("/")) return null;
  const base = p.split("/").pop() || "";
  if (
    /^(keterangan\.(md|json)|kelengkapan\.json|analisis\.json|dependency\.json|__MACOSX)/i.test(base) ||
    p.includes("__MACOSX/") ||
    p.startsWith(".")
  ) {
    return null;
  }
  return p;
}

function isMostlyText(bytes) {
  const n = Math.min(bytes.length, 800);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = bytes[i];
    if (c === 0) return false;
    if (c < 7 && c !== 9 && c !== 10 && c !== 13) bad++;
  }
  return bad < n * 0.05;
}

function bytesToUtf8(bytes) {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let j = 0; j < bytes.length; j += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(j, j + chunk));
  }
  return btoa(binary);
}

function uid() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function createTreeChained(env, apiBase, items, startBase, emit) {
  const CHUNK = 60;
  let base = startBase;
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    if (emit) {
      await emit({
        type: "phase",
        phase: "tree",
        message: `Git tree ${Math.min(i + slice.length, items.length)}/${items.length}…`,
        pct: 85
      });
    }
    const treeRes = await ghFetch(env, `${apiBase}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: base, tree: slice })
    });
    if (!treeRes.ok) {
      return {
        ok: false,
        status: treeRes.status,
        error: "Gagal buat tree: " + JSON.stringify(treeRes.data).slice(0, 300),
        detail: treeRes.data
      };
    }
    base = treeRes.data.sha;
  }
  return { ok: true, sha: base };
}

async function finalizeCommit(env, cfg, apiBase, prefix, baseCommitSha, treeSha, entriesCount, totalBytes, message, patchReport, gameId, slot, emit) {
  await emit({ type: "phase", phase: "commit", message: "Membuat commit…", pct: 92 });
  const msg =
    message ||
    `feat(hosting): upload ${prefix} via Game Collector (${entriesCount} files, ${Math.round(totalBytes / 1024)} KB)`;
  const newCommitRes = await ghFetch(env, `${apiBase}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: msg,
      tree: treeSha,
      parents: [baseCommitSha]
    })
  });
  if (!newCommitRes.ok) {
    return { ok: false, status: newCommitRes.status, error: "Gagal buat commit", detail: newCommitRes.data };
  }
  const newCommitSha = newCommitRes.data.sha;

  await emit({ type: "phase", phase: "ref", message: "Update branch main…", pct: 96 });
  const updateRef = await ghFetch(env, `${apiBase}/git/refs/heads/${cfg.branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommitSha, force: false })
  });
  if (!updateRef.ok) {
    return { ok: false, status: updateRef.status, error: "Gagal update branch", detail: updateRef.data };
  }

  const liveUrl = `${cfg.baseUrl}/${prefix}/`;
  const result = {
    ok: true,
    status: 200,
    game_slot: slot,
    path_prefix: prefix,
    game_id: gameId,
    files: entriesCount,
    bytes: totalBytes,
    commit: newCommitSha,
    commit_url: `https://github.com/${cfg.owner}/${cfg.repo}/commit/${newCommitSha}`,
    live_url: liveUrl,
    patch: {
      scanned: patchReport.scanned,
      patched: patchReport.patched,
      injected_html: patchReport.injectedHtml,
      edu_base: patchReport.eduBase,
      details: (patchReport.files || []).slice(0, 40)
    },
    note: "Cloudflare Pages biasanya deploy dalam 1–3 menit setelah push. API auto-patch: base → EDU + SDK inject."
  };
  await emit({ type: "done", pct: 100, result });
  return result;
}

/**
 * @param {object} env
 * @param {number} gameSlot
 * @param {Record<string, Uint8Array>} files
 * @param {string} [message]
 * @param {(ev: object) => void|Promise<void>} [onProgress]
 * @param {Uint8Array} [rawZipBytes] — opsional, untuk session continue (simpan ZIP di KV)
 */
export async function uploadGameToEduNetwork(env, gameSlot, files, message, onProgress, rawZipBytes) {
  const emit = async (ev) => {
    try {
      if (typeof onProgress === "function") await onProgress(ev);
    } catch (_) {}
  };

  const slot = Number(gameSlot);
  if (!Number.isInteger(slot) || slot < 1 || slot > 150) {
    return { ok: false, status: 400, error: "game_slot harus integer 1–150" };
  }
  if (!env.GITHUB_TOKEN) {
    return {
      ok: false,
      status: 503,
      error: "GITHUB_TOKEN belum di-set di Worker secrets (butuh scope contents:write ke Edu-network)"
    };
  }

  const cfg = eduConfig(env);
  const prefix = `game-${slot}`;
  const gameId = prefix;
  const apiBase = `/repos/${cfg.owner}/${cfg.repo}`;

  await emit({ type: "phase", phase: "patch", message: "Auto-patch API + path + SDK…", pct: 8 });

  const { files: patchedFiles, report: patchReport } = patchFilesForEdu(files || {}, {
    eduBase: cfg.baseUrl,
    gameId
  });

  await emit({
    type: "phase",
    phase: "patch_done",
    message: `Patch ${patchReport.patched}/${patchReport.scanned} file`,
    pct: 12,
    patch: {
      scanned: patchReport.scanned,
      patched: patchReport.patched,
      injected_html: patchReport.injectedHtml
    }
  });

  const entries = [];
  let totalBytes = 0;
  for (const [raw, data] of Object.entries(patchedFiles)) {
    const rel = normalizeGamePath(raw);
    if (!rel || !(data instanceof Uint8Array)) continue;
    if (data.byteLength > MAX_FILE_BYTES) {
      return {
        ok: false,
        status: 400,
        error: `File melebihi 25 MB: ${rel} (${Math.round(data.byteLength / 1024 / 1024)} MB)`
      };
    }
    totalBytes += data.byteLength;
    entries.push({ path: `${prefix}/${rel}`, rel, data, size: data.byteLength });
  }

  if (!entries.length) {
    return { ok: false, status: 400, error: "Tidak ada file valid di paket (butuh index.html + aset)" };
  }
  if (entries.length > MAX_FILES) {
    return {
      ok: false,
      status: 400,
      error: `Terlalu banyak file (${entries.length}). Maks ${MAX_FILES} per upload.`
    };
  }
  const hasIndex = entries.some((e) => /(^|\/)index\.html$/i.test(e.path));
  if (!hasIndex) {
    return { ok: false, status: 400, error: "Paket harus berisi index.html" };
  }

  await emit({
    type: "phase",
    phase: "list",
    message: `${entries.length} file siap di-upload ke Git`,
    pct: 15,
    total: entries.length,
    files: entries.map((e) => ({ path: e.rel, size: e.size }))
  });

  await emit({ type: "phase", phase: "git_ref", message: "Baca branch Edu-network…", pct: 18 });
  const refRes = await ghFetch(env, `${apiBase}/git/ref/heads/${cfg.branch}`);
  if (!refRes.ok) {
    return {
      ok: false,
      status: refRes.status,
      error: "Gagal baca branch Edu-network",
      detail: refRes.data
    };
  }
  const baseCommitSha = refRes.data?.object?.sha;
  if (!baseCommitSha) {
    return { ok: false, status: 500, error: "Branch SHA kosong" };
  }

  const commitRes = await ghFetch(env, `${apiBase}/git/commits/${baseCommitSha}`);
  if (!commitRes.ok) {
    return { ok: false, status: commitRes.status, error: "Gagal baca commit base", detail: commitRes.data };
  }
  let treeSha = commitRes.data?.tree?.sha;

  const textEntries = [];
  const binEntries = [];
  for (const e of entries) {
    if (TEXT_RE.test(e.rel) && e.size < 900_000 && isMostlyText(e.data)) textEntries.push(e);
    else binEntries.push(e);
  }

  const total = entries.length;
  let doneCount = 0;
  const treeItems = [];

  await emit({
    type: "phase",
    phase: "blobs",
    message: `Siapkan: ${textEntries.length} teks inline + ${binEntries.length} binary (batch max ${MAX_BLOB_PER_INVOKE}/request)…`,
    pct: 20,
    total
  });

  // Text → inline content (0 blob subrequest)
  for (const e of textEntries) {
    await emit({
      type: "file",
      path: e.rel,
      fullPath: e.path,
      index: doneCount + 1,
      total,
      size: e.size,
      status: "uploading",
      pct: 20 + Math.round((doneCount / total) * 65)
    });
    treeItems.push({
      path: e.path,
      mode: "100644",
      type: "blob",
      content: bytesToUtf8(e.data)
    });
    doneCount++;
    await emit({
      type: "file",
      path: e.rel,
      fullPath: e.path,
      index: doneCount,
      total,
      size: e.size,
      status: "ok",
      pct: 20 + Math.round((doneCount / total) * 65)
    });
  }

  // Apply text tree first
  if (treeItems.length) {
    const t1 = await createTreeChained(env, apiBase, treeItems, treeSha, emit);
    if (!t1.ok) {
      await emit({ type: "error", error: t1.error, pct: 30 });
      return t1;
    }
    treeSha = t1.sha;
  }

  // Binary blobs — max MAX_BLOB_PER_INVOKE per invocation
  const firstBatch = binEntries.slice(0, MAX_BLOB_PER_INVOKE);
  const remainingBin = binEntries.slice(MAX_BLOB_PER_INVOKE);
  const BATCH = 5;

  for (let i = 0; i < firstBatch.length; i += BATCH) {
    const slice = firstBatch.slice(i, i + BATCH);
    for (const e of slice) {
      await emit({
        type: "file",
        path: e.rel,
        fullPath: e.path,
        index: doneCount + 1,
        total,
        size: e.size,
        status: "uploading",
        pct: 20 + Math.round((doneCount / total) * 65)
      });
    }
    let results;
    try {
      results = await Promise.all(
        slice.map(async (e) => {
          const content = bytesToBase64(e.data);
          const blobRes = await ghFetch(env, `${apiBase}/git/blobs`, {
            method: "POST",
            body: JSON.stringify({ content, encoding: "base64" })
          });
          if (!blobRes.ok) {
            throw new Error(`Blob gagal ${e.rel}: HTTP ${blobRes.status} ${JSON.stringify(blobRes.data).slice(0, 180)}`);
          }
          return { path: e.path, rel: e.rel, size: e.size, mode: "100644", type: "blob", sha: blobRes.data.sha };
        })
      );
    } catch (err) {
      await emit({ type: "error", error: err?.message || String(err) });
      return { ok: false, status: 502, error: err?.message || String(err) };
    }
    const binTree = [];
    for (const r of results) {
      doneCount++;
      binTree.push({ path: r.path, mode: r.mode, type: r.type, sha: r.sha });
      await emit({
        type: "file",
        path: r.rel,
        fullPath: r.path,
        index: doneCount,
        total,
        size: r.size,
        status: "ok",
        pct: 20 + Math.round((doneCount / total) * 65)
      });
    }
    const tBin = await createTreeChained(env, apiBase, binTree, treeSha, null);
    if (!tBin.ok) {
      await emit({ type: "error", error: tBin.error });
      return tBin;
    }
    treeSha = tBin.sha;
  }

  // Need continue for remaining binaries?
  if (remainingBin.length > 0) {
    if (!env.GC_HISTORY) {
      return {
        ok: false,
        status: 503,
        error: `Sisa ${remainingBin.length} file binary, tapi KV tidak tersedia untuk multi-batch. Kurangi aset atau aktifkan KV.`
      };
    }
    const sessionId = uid();
    // Simpan sisa binary sebagai base64 di KV (bukan ZIP penuh) — continue ringan, anti-503
    const binPack = {};
    let packBytes = 0;
    for (const e of remainingBin) {
      const b64 = bytesToBase64(e.data);
      binPack[e.rel] = b64;
      packBytes += b64.length;
    }
    if (packBytes > 23 * 1024 * 1024) {
      return {
        ok: false,
        status: 413,
        error: `Sisa binary terlalu besar untuk session (${Math.round(packBytes / 1024 / 1024)} MB). Kurangi aset gambar/audio.`
      };
    }
    await env.GC_HISTORY.put(`edu-bin:${sessionId}`, JSON.stringify(binPack), {
      expirationTtl: SESSION_TTL
    });
    const session = {
      v: 2,
      slot,
      message: message || "",
      prefix,
      gameId,
      baseCommitSha,
      treeSha,
      doneCount,
      total,
      totalBytes,
      remainingRels: remainingBin.map((e) => e.rel),
      hasBinPack: true,
      patchReport: {
        scanned: patchReport.scanned,
        patched: patchReport.patched,
        injectedHtml: patchReport.injectedHtml,
        eduBase: patchReport.eduBase,
        files: (patchReport.files || []).slice(0, 20)
      }
    };
    await env.GC_HISTORY.put(`edu-up:${sessionId}`, JSON.stringify(session), {
      expirationTtl: SESSION_TTL
    });

    await emit({
      type: "continue",
      session_id: sessionId,
      done: doneCount,
      total,
      remaining: remainingBin.length,
      pct: 20 + Math.round((doneCount / total) * 65),
      message: `Batch 1 selesai (${doneCount}/${total}). Lanjut ${remainingBin.length} file…`,
      need_zip: false
    });
    return {
      ok: true,
      continue: true,
      session_id: sessionId,
      done: doneCount,
      total,
      remaining: remainingBin.length
    };
  }

  // All done → commit
  return finalizeCommit(
    env,
    cfg,
    apiBase,
    prefix,
    baseCommitSha,
    treeSha,
    total,
    totalBytes,
    message,
    patchReport,
    gameId,
    slot,
    emit
  );
}

/**
 * Lanjut upload binary tersisa dari session KV.
 * @param {object} env
 * @param {string} sessionId
 * @param {Record<string, Uint8Array>} [filesMap] — wajib jika zip tidak di KV
 * @param {(ev:object)=>void} [onProgress]
 */
export async function continueEduUpload(env, sessionId, filesMap, onProgress) {
  const emit = async (ev) => {
    try {
      if (typeof onProgress === "function") await onProgress(ev);
    } catch (_) {}
  };

  if (!env.GC_HISTORY) {
    return { ok: false, status: 503, error: "KV tidak tersedia" };
  }
  if (!env.GITHUB_TOKEN) {
    return { ok: false, status: 503, error: "GITHUB_TOKEN belum di-set" };
  }

  const raw = await env.GC_HISTORY.get(`edu-up:${sessionId}`);
  if (!raw) {
    return { ok: false, status: 404, error: "Session upload tidak ditemukan / expired. Upload ulang." };
  }
  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    return { ok: false, status: 500, error: "Session corrupt" };
  }

  const cfg = eduConfig(env);
  const apiBase = `/repos/${cfg.owner}/${cfg.repo}`;
  const {
    slot,
    message,
    prefix,
    gameId,
    baseCommitSha,
    total,
    totalBytes,
    patchReport
  } = session;
  let { treeSha, doneCount, remainingRels } = session;

  // Resolve bytes: prefer edu-bin pack (base64) — no unzip, anti-503
  const byRel = Object.create(null);
  if (session.hasBinPack) {
    try {
      const packRaw = await env.GC_HISTORY.get(`edu-bin:${sessionId}`);
      if (!packRaw) {
        return { ok: false, status: 400, error: "Bin pack session hilang. Upload ulang." };
      }
      const pack = JSON.parse(packRaw);
      for (const [rel, b64] of Object.entries(pack)) {
        try {
          const binary = atob(b64);
          const out = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
          byRel[rel] = out;
        } catch (_) {}
      }
    } catch (e) {
      return { ok: false, status: 500, error: "Gagal baca bin pack: " + (e?.message || e) };
    }
  } else if (filesMap && Object.keys(filesMap).length) {
    const { files: patched } = patchFilesForEdu(filesMap, {
      eduBase: cfg.baseUrl,
      gameId
    });
    for (const [raw, data] of Object.entries(patched)) {
      const rel = normalizeGamePath(raw);
      if (rel && data instanceof Uint8Array) byRel[rel] = data;
    }
  } else {
    return {
      ok: false,
      status: 400,
      error: "Tidak ada data file untuk continue. Upload ulang dari awal."
    };
  }

  const batchRels = remainingRels.slice(0, MAX_BLOB_PER_INVOKE);
  const stillLeft = remainingRels.slice(MAX_BLOB_PER_INVOKE);

  await emit({
    type: "phase",
    phase: "blobs",
    message: `Batch lanjut: ${batchRels.length} file (${doneCount}/${total} done, sisa ${stillLeft.length})…`,
    pct: 20 + Math.round((doneCount / total) * 65),
    total
  });

  const BATCH = 4;
  for (let i = 0; i < batchRels.length; i += BATCH) {
    const slice = batchRels.slice(i, i + BATCH);
    const entries = [];
    for (const rel of slice) {
      const data = byRel[rel];
      if (!data) {
        await emit({ type: "error", error: `File hilang di session: ${rel}` });
        return { ok: false, status: 400, error: `File hilang di session: ${rel}` };
      }
      entries.push({ path: `${prefix}/${rel}`, rel, data, size: data.byteLength });
      await emit({
        type: "file",
        path: rel,
        fullPath: `${prefix}/${rel}`,
        index: doneCount + 1,
        total,
        size: data.byteLength,
        status: "uploading",
        pct: 20 + Math.round((doneCount / total) * 65)
      });
    }
    let results;
    try {
      results = await Promise.all(
        entries.map(async (e) => {
          const content = bytesToBase64(e.data);
          const blobRes = await ghFetch(env, `${apiBase}/git/blobs`, {
            method: "POST",
            body: JSON.stringify({ content, encoding: "base64" })
          });
          if (!blobRes.ok) {
            throw new Error(`Blob gagal ${e.rel}: HTTP ${blobRes.status}`);
          }
          return { path: e.path, rel: e.rel, size: e.size, mode: "100644", type: "blob", sha: blobRes.data.sha };
        })
      );
    } catch (err) {
      await emit({ type: "error", error: err?.message || String(err) });
      return { ok: false, status: 502, error: err?.message || String(err) };
    }
    const binTree = results.map((r) => ({ path: r.path, mode: r.mode, type: r.type, sha: r.sha }));
    for (const r of results) {
      doneCount++;
      await emit({
        type: "file",
        path: r.rel,
        fullPath: r.path,
        index: doneCount,
        total,
        size: r.size,
        status: "ok",
        pct: 20 + Math.round((doneCount / total) * 65)
      });
    }
    const tBin = await createTreeChained(env, apiBase, binTree, treeSha, null);
    if (!tBin.ok) {
      await emit({ type: "error", error: tBin.error });
      return tBin;
    }
    treeSha = tBin.sha;
  }

  if (stillLeft.length > 0) {
    session.treeSha = treeSha;
    session.doneCount = doneCount;
    session.remainingRels = stillLeft;
    // trim bin pack agar KV lebih kecil
    if (session.hasBinPack) {
      try {
        const packRaw = await env.GC_HISTORY.get(`edu-bin:${sessionId}`);
        if (packRaw) {
          const pack = JSON.parse(packRaw);
          const next = {};
          for (const rel of stillLeft) {
            if (pack[rel] != null) next[rel] = pack[rel];
          }
          await env.GC_HISTORY.put(`edu-bin:${sessionId}`, JSON.stringify(next), {
            expirationTtl: SESSION_TTL
          });
        }
      } catch (_) {}
    }
    await env.GC_HISTORY.put(`edu-up:${sessionId}`, JSON.stringify(session), {
      expirationTtl: SESSION_TTL
    });
    await emit({
      type: "continue",
      session_id: sessionId,
      done: doneCount,
      total,
      remaining: stillLeft.length,
      need_zip: false,
      pct: 20 + Math.round((doneCount / total) * 65),
      message: `Batch selesai (${doneCount}/${total}). Lanjut ${stillLeft.length} file…`
    });
    return {
      ok: true,
      continue: true,
      session_id: sessionId,
      done: doneCount,
      total,
      remaining: stillLeft.length
    };
  }

  // Cleanup session
  try {
    await env.GC_HISTORY.delete(`edu-up:${sessionId}`);
    await env.GC_HISTORY.delete(`edu-zip:${sessionId}`);
    await env.GC_HISTORY.delete(`edu-bin:${sessionId}`);
  } catch (_) {}

  return finalizeCommit(
    env,
    cfg,
    apiBase,
    prefix,
    baseCommitSha,
    treeSha,
    total,
    totalBytes,
    message,
    patchReport,
    gameId,
    slot,
    emit
  );
}

export { eduConfig, normalizeGamePath, MAX_FILE_BYTES };
