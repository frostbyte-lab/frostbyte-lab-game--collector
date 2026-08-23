/**
 * Upload paket game (ZIP files map) ke repo Edu-network via GitHub Git Trees API.
 * Target path: game-{N}/... di branch main → Cloudflare Pages auto-deploy.
 * Auto-patch API base + inject SDK sebelum commit.
 */
import { ghFetch } from "../collect/github.js";
import { patchFilesForEdu } from "./edu-patch.js";

const DEFAULT_EDU = {
  owner: "frostbyte-lab",
  repo: "Edu-network",
  branch: "main",
  baseUrl: "https://ea29118c.edu-network.pages.dev"
};

/** Max single file 25 MB — sama dengan scripts/check-sizes.js di Edu-network */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Batas aman jumlah blob per commit (GitHub tree) */
const MAX_FILES = 400;

function eduConfig(env = {}) {
  return {
    owner: env.EDU_GH_OWNER || DEFAULT_EDU.owner,
    repo: env.EDU_GH_REPO || DEFAULT_EDU.repo,
    branch: env.EDU_GH_BRANCH || DEFAULT_EDU.branch,
    baseUrl: (env.EDU_PAGES_URL || DEFAULT_EDU.baseUrl).replace(/\/$/, "")
  };
}

/**
 * Normalisasi path file dari ZIP JSZip ke path relatif di dalam game-N/.
 * Buang prefix umum: assets/, game/, dist/, build/, public/
 */
function normalizeGamePath(rawPath) {
  let p = String(rawPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
  if (!p || p.endsWith("/")) return null;
  // skip metadata collector
  const base = p.split("/").pop() || "";
  if (
    /^(keterangan\.(md|json)|kelengkapan\.json|analisis\.json|dependency\.json|__MACOSX)/i.test(base) ||
    p.includes("__MACOSX/") ||
    p.startsWith(".")
  ) {
    return null;
  }
  // jika ZIP root berisi satu folder game, flatten satu level jika semua file di bawahnya
  return p;
}

/**
 * @param {object} env
 * @param {number} gameSlot 1–150
 * @param {Record<string, Uint8Array>} files path -> bytes (isi ZIP sudah di-extract)
 * @param {string} [message]
 * @param {(ev: object) => void|Promise<void>} [onProgress]
 */
export async function uploadGameToEduNetwork(env, gameSlot, files, message, onProgress) {
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
  const gameId = prefix; // game-12 → game_id di API EDU

  await emit({ type: "phase", phase: "patch", message: "Auto-patch API + path + SDK…", pct: 8 });

  // Auto-patch: rewrite API host → EDU + inject SDK + gameId
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

  // Build path list
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
  const hasIndex = entries.some((e) => e.path === `${prefix}/index.html` || e.path.endsWith("/index.html"));
  if (!hasIndex) {
    // coba cari index di root entries tanpa subfolder dalam
    const rootIndex = entries.find((e) => /(^|\/)index\.html$/i.test(e.path));
    if (!rootIndex) {
      return { ok: false, status: 400, error: "Paket harus berisi index.html" };
    }
  }

  await emit({
    type: "phase",
    phase: "list",
    message: `${entries.length} file siap di-upload ke Git`,
    pct: 15,
    total: entries.length,
    files: entries.map((e) => ({ path: e.rel, size: e.size }))
  });

  const apiBase = `/repos/${cfg.owner}/${cfg.repo}`;

  // 1) ref → commit SHA
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

  // 2) commit → tree SHA
  const commitRes = await ghFetch(env, `${apiBase}/git/commits/${baseCommitSha}`);
  if (!commitRes.ok) {
    return { ok: false, status: commitRes.status, error: "Gagal baca commit base", detail: commitRes.data };
  }
  const baseTreeSha = commitRes.data?.tree?.sha;

  // 3) Build tree items
  // Text files: inline `content` di tree API (tanpa 1 request/blob) → hemat subrequest & waktu
  // Binary: blob API base64 (batch)
  const TEXT_RE = /\.(html?|js|mjs|cjs|json|css|txt|svg|xml|map|md|csv|tsv|vtt|glsl|vert|frag)$/i;
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

  const total = entries.length;
  const treeItems = [];
  let doneCount = 0;

  const textEntries = [];
  const binEntries = [];
  for (const e of entries) {
    if (TEXT_RE.test(e.rel) && e.size < 900_000 && isMostlyText(e.data)) textEntries.push(e);
    else binEntries.push(e);
  }

  await emit({
    type: "phase",
    phase: "blobs",
    message: `Siapkan tree: ${textEntries.length} teks inline + ${binEntries.length} binary blob…`,
    pct: 20,
    total
  });

  // 3a) text → tree content (langsung, progress cepat)
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

  // 3b) binary → blob API (batch 6)
  const BATCH = 6;
  for (let i = 0; i < binEntries.length; i += BATCH) {
    const slice = binEntries.slice(i, i + BATCH);
    for (const e of slice) {
      await emit({
        type: "file",
        path: e.rel,
        fullPath: e.path,
        index: doneCount + slice.indexOf(e) + 1,
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
            const detail = JSON.stringify(blobRes.data).slice(0, 200);
            throw new Error(`Blob gagal ${e.rel}: HTTP ${blobRes.status} ${detail}`);
          }
          return {
            path: e.path,
            rel: e.rel,
            size: e.size,
            mode: "100644",
            type: "blob",
            sha: blobRes.data.sha
          };
        })
      );
    } catch (err) {
      await emit({
        type: "error",
        error: err?.message || String(err),
        pct: 20 + Math.round((doneCount / total) * 65)
      });
      return { ok: false, status: 502, error: err?.message || String(err) };
    }
    for (const r of results) {
      doneCount++;
      treeItems.push({ path: r.path, mode: r.mode, type: r.type, sha: r.sha });
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
  }

  // GitHub tree API: jangan kirim >~100 item content sekaligus (body besar)
  // Jika terlalu banyak, pecah create tree berantai
  async function createTreeChained(items, startBase) {
    const CHUNK = 80;
    let base = startBase;
    for (let i = 0; i < items.length; i += CHUNK) {
      const slice = items.slice(i, i + CHUNK);
      await emit({
        type: "phase",
        phase: "tree",
        message: `Git tree ${Math.min(i + slice.length, items.length)}/${items.length}…`,
        pct: 85 + Math.round((i / items.length) * 5)
      });
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

  // 4) create tree (base_tree agar file lain di repo tetap) — berantai jika banyak
  await emit({ type: "phase", phase: "tree", message: "Membangun Git tree…", pct: 88 });
  const treeChain = await createTreeChained(treeItems, baseTreeSha);
  if (!treeChain.ok) {
    await emit({ type: "error", error: treeChain.error, pct: 88 });
    return treeChain;
  }
  const newTreeSha = treeChain.sha;

  // 5) commit
  await emit({ type: "phase", phase: "commit", message: "Membuat commit…", pct: 92 });
  const msg =
    message ||
    `feat(hosting): upload ${prefix} via Game Collector (${entries.length} files, ${Math.round(totalBytes / 1024)} KB)`;
  const newCommitRes = await ghFetch(env, `${apiBase}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: msg,
      tree: newTreeSha,
      parents: [baseCommitSha]
    })
  });
  if (!newCommitRes.ok) {
    return { ok: false, status: newCommitRes.status, error: "Gagal buat commit", detail: newCommitRes.data };
  }
  const newCommitSha = newCommitRes.data.sha;

  // 6) update ref
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
    files: entries.length,
    bytes: totalBytes,
    commit: newCommitSha,
    commit_url: `https://github.com/${cfg.owner}/${cfg.repo}/commit/${newCommitSha}`,
    live_url: liveUrl,
    patch: {
      scanned: patchReport.scanned,
      patched: patchReport.patched,
      injected_html: patchReport.injectedHtml,
      edu_base: patchReport.eduBase,
      details: patchReport.files.slice(0, 40)
    },
    note: "Cloudflare Pages biasanya deploy dalam 1–3 menit setelah push. API auto-patch: base → EDU + SDK inject."
  };
  await emit({ type: "done", pct: 100, result });
  return result;
}

export { eduConfig, normalizeGamePath, MAX_FILE_BYTES };
