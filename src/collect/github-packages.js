import { ghFetch } from "./github.js";

const DEFAULT_BRANCH = "collector-packages";
const MAX_PACKAGE_BYTES = 80 * 1024 * 1024;

function cfg(env = {}) {
  return {
    owner: env.GH_OWNER || "frostbyte-lab",
    repo: env.GH_REPO || "frostbyte-lab-game--collector",
    branch: env.GC_PACKAGE_BRANCH || DEFAULT_BRANCH
  };
}

function safeId(value) {
  const id = String(value || "").trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return id || `package-${Date.now()}`;
}

function b64(bytes) {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

function fromB64(value) {
  const raw = atob(String(value || "").replace(/\s/g, ""));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function branchBase(env, c) {
  const ref = await ghFetch(env, `/repos/${c.owner}/${c.repo}/git/ref/heads/${encodeURIComponent(c.branch)}`);
  if (ref.ok) return { sha: ref.data?.object?.sha, created: false };
  if (ref.status !== 404) return { error: "Gagal membaca branch paket", status: ref.status, detail: ref.data };
  const main = await ghFetch(env, `/repos/${c.owner}/${c.repo}/git/ref/heads/main`);
  if (!main.ok || !main.data?.object?.sha) return { error: "Branch main tidak ditemukan", status: main.status, detail: main.data };
  const made = await ghFetch(env, `/repos/${c.owner}/${c.repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${c.branch}`, sha: main.data.object.sha })
  });
  if (!made.ok && made.status !== 422) return { error: "Gagal membuat branch paket", status: made.status, detail: made.data };
  return { sha: main.data.object.sha, created: true };
}

export async function savePackageToGitHub(env, bytes, options = {}) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!env.GITHUB_TOKEN) return { ok: false, status: 503, error: "GITHUB_TOKEN belum di-set di Worker" };
  if (!data.length) return { ok: false, status: 400, error: "ZIP kosong" };
  if (data.length > MAX_PACKAGE_BYTES) return { ok: false, status: 413, error: `ZIP terlalu besar (maks ${MAX_PACKAGE_BYTES / 1024 / 1024} MB)` };
  const c = cfg(env);
  const id = safeId(options.packageId || options.id);
  const prefix = `packages/${id}`;
  const base = await branchBase(env, c);
  if (base.error) return { ok: false, status: base.status || 500, error: base.error, detail: base.detail };
  const commitRes = await ghFetch(env, `/repos/${c.owner}/${c.repo}/git/commits/${base.sha}`);
  if (!commitRes.ok) return { ok: false, status: commitRes.status, error: "Gagal membaca commit dasar", detail: commitRes.data };
  const treeBase = commitRes.data?.tree?.sha;
  const blob = await ghFetch(env, `/repos/${c.owner}/${c.repo}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: b64(data), encoding: "base64" })
  });
  if (!blob.ok || !blob.data?.sha) return { ok: false, status: blob.status || 502, error: "Gagal mengunggah ZIP ke GitHub", detail: blob.data };
  const meta = new TextEncoder().encode(JSON.stringify({
    package_id: id, source: options.source || "collector", target_url: options.targetUrl || "",
    bytes: data.byteLength, saved_at: new Date().toISOString(), format: "zip"
  }, null, 2) + "\n");
  const metaBlob = await ghFetch(env, `/repos/${c.owner}/${c.repo}/git/blobs`, {
    method: "POST", body: JSON.stringify({ content: b64(meta), encoding: "base64" })
  });
  if (!metaBlob.ok || !metaBlob.data?.sha) return { ok: false, status: metaBlob.status || 502, error: "Gagal menyimpan metadata paket", detail: metaBlob.data };
  const tree = await ghFetch(env, `/repos/${c.owner}/${c.repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: treeBase, tree: [
      { path: `${prefix}/game-resources.zip`, mode: "100644", type: "blob", sha: blob.data.sha },
      { path: `${prefix}/package.json`, mode: "100644", type: "blob", sha: metaBlob.data.sha }
    ] })
  });
  if (!tree.ok || !tree.data?.sha) return { ok: false, status: tree.status || 502, error: "Gagal membuat Git tree paket", detail: tree.data };
  const commit = await ghFetch(env, `/repos/${c.owner}/${c.repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message: options.message || `chore(collector): simpan paket ${id}`, tree: tree.data.sha, parents: [base.sha] })
  });
  if (!commit.ok || !commit.data?.sha) return { ok: false, status: commit.status || 502, error: "Gagal membuat commit paket", detail: commit.data };
  const ref = await ghFetch(env, `/repos/${c.owner}/${c.repo}/git/refs/heads/${encodeURIComponent(c.branch)}`, {
    method: "PATCH", body: JSON.stringify({ sha: commit.data.sha, force: false })
  });
  if (!ref.ok) return { ok: false, status: ref.status, error: "Gagal memperbarui branch paket", detail: ref.data };
  return {
    ok: true, package_id: id, branch: c.branch, path: `${prefix}/game-resources.zip`, bytes: data.byteLength,
    saved_at: new Date().toISOString(), source: options.source || "collector", target_url: options.targetUrl || "",
    commit: commit.data.sha, commit_url: `https://github.com/${c.owner}/${c.repo}/commit/${commit.data.sha}`,
    repo_url: `https://github.com/${c.owner}/${c.repo}/tree/${encodeURIComponent(c.branch)}/${prefix}`
  };
}

export async function listGitHubPackages(env) {
  if (!env.GITHUB_TOKEN) return { ok: false, status: 503, error: "GITHUB_TOKEN belum di-set di Worker" };
  const c = cfg(env);
  const base = await branchBase(env, c);
  if (base.error) return { ok: false, status: base.status || 500, error: base.error, detail: base.detail };
  const commit = await ghFetch(env, `/repos/${c.owner}/${c.repo}/git/commits/${base.sha}`);
  if (!commit.ok) return { ok: false, status: commit.status, error: "Gagal membaca branch paket" };
  const tree = await ghFetch(env, `/repos/${c.owner}/${c.repo}/git/trees/${commit.data.tree.sha}?recursive=1`);
  if (!tree.ok) return { ok: false, status: tree.status, error: "Gagal membaca daftar paket" };
  const packages = [];
  for (const x of (tree.data.tree || []).filter(x => /^packages\/[^/]+\/game-resources\.zip$/i.test(x.path)).slice(-50).reverse()) {
    const packageId = x.path.split("/")[1];
    let meta = {};
    try {
      const mf = await ghFetch(env, `/repos/${c.owner}/${c.repo}/contents/packages/${encodeURIComponent(packageId)}/package.json?ref=${encodeURIComponent(c.branch)}`);
      if (mf.ok && mf.data?.content) meta = JSON.parse(new TextDecoder().decode(fromB64(mf.data.content)));
    } catch {}
    packages.push({
      package_id: packageId, path: x.path, sha: x.sha, size: x.size || 0,
      saved_at: meta.saved_at || null, source: meta.source || null, target_url: meta.target_url || null,
      branch: c.branch, repo_url: `https://github.com/${c.owner}/${c.repo}/tree/${encodeURIComponent(c.branch)}/packages/${packageId}`
    });
  }
  return { ok: true, branch: c.branch, packages };
}

export async function downloadGitHubPackage(env, id) {
  if (!env.GITHUB_TOKEN) return { ok: false, status: 503, error: "GITHUB_TOKEN belum di-set di Worker" };
  const c = cfg(env);
  const packageId = safeId(id);
  const path = `packages/${packageId}/game-resources.zip`;
  const file = await ghFetch(env, `/repos/${c.owner}/${c.repo}/contents/${path}?ref=${encodeURIComponent(c.branch)}`);
  if (!file.ok || !file.data?.sha) return { ok: false, status: file.status || 404, error: "Paket GitHub tidak ditemukan", detail: file.data };
  const blob = await ghFetch(env, `/repos/${c.owner}/${c.repo}/git/blobs/${file.data.sha}`);
  if (!blob.ok || !blob.data?.content) return { ok: false, status: blob.status || 502, error: "Gagal mengambil ZIP paket", detail: blob.data };
  return { ok: true, bytes: fromB64(blob.data.content), filename: `${packageId}.zip`, package_id: packageId, branch: c.branch };
}

export { MAX_PACKAGE_BYTES };
