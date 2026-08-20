/**
 * History + session resume helpers (Cloudflare KV opsional).
 * Binding: env.GC_HISTORY
 * Schema history: { id, url, ts, status, files, zipSize, totals, message?, elapsed?, stillMissing? }
 * Schema session:  sess:{id} → { id, url, ts, phase, seen: string[], stillMissing: {url,reason?}[], totals? }
 */

const HISTORY_PREFIX = "hist:";
const SESSION_PREFIX = "sess:";
const INDEX_KEY = "hist:index";
const MAX_HISTORY = 50;
const SESSION_TTL = 60 * 60 * 24; // 24 jam

export function hasKV(env) {
  return Boolean(env && env.GC_HISTORY);
}

export async function listHistory(env, limit = 30) {
  if (!hasKV(env)) return { items: [], source: "none" };
  try {
    const idx = await env.GC_HISTORY.get(INDEX_KEY, "json");
    const ids = Array.isArray(idx) ? idx.slice(0, limit) : [];
    const items = [];
    for (const id of ids) {
      const row = await env.GC_HISTORY.get(HISTORY_PREFIX + id, "json");
      if (row) items.push(row);
    }
    return { items, source: "kv" };
  } catch (e) {
    return { items: [], source: "error", error: String(e.message || e) };
  }
}

export async function putHistory(env, entry) {
  if (!hasKV(env)) return { ok: false, reason: "no-kv" };
  const id = entry.id || crypto.randomUUID();
  const row = {
    id,
    url: entry.url || "",
    ts: entry.ts || new Date().toISOString(),
    status: entry.status || "ok",
    files: entry.files ?? null,
    zipSize: entry.zipSize ?? null,
    totals: entry.totals || null,
    message: entry.message || null,
    elapsed: entry.elapsed ?? null,
    stillMissing: entry.stillMissing || null,
    overallScore: entry.overallScore ?? null,
    source: entry.source || null,
    kind: entry.kind || null,
    errorCode: entry.errorCode || null,
    ip: entry.ip || null,
    userAgent: entry.userAgent || null,
    details: Array.isArray(entry.details) ? entry.details.slice(0, 50) : null
  };
  await env.GC_HISTORY.put(HISTORY_PREFIX + id, JSON.stringify(row));
  let idx = (await env.GC_HISTORY.get(INDEX_KEY, "json")) || [];
  if (!Array.isArray(idx)) idx = [];
  idx = [id, ...idx.filter((x) => x !== id)].slice(0, MAX_HISTORY);
  await env.GC_HISTORY.put(INDEX_KEY, JSON.stringify(idx));
  return { ok: true, id, source: "kv" };
}

export async function deleteHistory(env, id) {
  if (!hasKV(env)) return { ok: false, reason: "no-kv" };
  if (!id) return { ok: false, reason: "no-id" };
  await env.GC_HISTORY.delete(HISTORY_PREFIX + id);
  let idx = (await env.GC_HISTORY.get(INDEX_KEY, "json")) || [];
  if (Array.isArray(idx)) {
    idx = idx.filter((x) => x !== id);
    await env.GC_HISTORY.put(INDEX_KEY, JSON.stringify(idx));
  }
  return { ok: true };
}

export async function clearHistory(env) {
  if (!hasKV(env)) return { ok: false, reason: "no-kv" };
  const idx = (await env.GC_HISTORY.get(INDEX_KEY, "json")) || [];
  if (Array.isArray(idx)) {
    for (const id of idx) {
      try { await env.GC_HISTORY.delete(HISTORY_PREFIX + id); } catch {}
    }
  }
  await env.GC_HISTORY.put(INDEX_KEY, JSON.stringify([]));
  return { ok: true };
}

export async function saveSession(env, session) {
  if (!hasKV(env)) return { ok: false, reason: "no-kv" };
  const id = session.id || crypto.randomUUID();
  const row = {
    id,
    url: session.url || "",
    ts: new Date().toISOString(),
    phase: session.phase || "partial",
    seen: Array.isArray(session.seen) ? session.seen.slice(0, 5000) : [],
    stillMissing: Array.isArray(session.stillMissing) ? session.stillMissing.slice(0, 500) : [],
    totals: session.totals || null,
    note: session.note || null
  };
  await env.GC_HISTORY.put(SESSION_PREFIX + id, JSON.stringify(row), { expirationTtl: SESSION_TTL });
  return { ok: true, id, source: "kv", expiresInSec: SESSION_TTL };
}

export async function getSession(env, id) {
  if (!hasKV(env) || !id) return null;
  try {
    return await env.GC_HISTORY.get(SESSION_PREFIX + id, "json");
  } catch {
    return null;
  }
}

export async function deleteSession(env, id) {
  if (!hasKV(env) || !id) return { ok: false };
  await env.GC_HISTORY.delete(SESSION_PREFIX + id);
  return { ok: true };
}
