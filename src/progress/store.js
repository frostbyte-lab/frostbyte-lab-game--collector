/**
 * Real progress collect — simpan fase di KV (GC_HISTORY) agar UI bisa poll.
 * Key: prog:{id}
 * TTL: 30 menit
 */

const PREFIX = "prog:";
const TTL = 60 * 30;

export function hasProgressStore(env) {
  return Boolean(env && env.GC_HISTORY);
}

export async function setProgress(env, id, data) {
  if (!hasProgressStore(env) || !id) return;
  const row = {
    id,
    pct: Math.max(0, Math.min(100, Number(data.pct) || 0)),
    phase: data.phase || "unknown",
    label: data.label || data.phase || "",
    detail: data.detail || null,
    files: data.files ?? null,
    ts: new Date().toISOString(),
    done: Boolean(data.done),
    error: data.error || null
  };
  try {
    await env.GC_HISTORY.put(PREFIX + id, JSON.stringify(row), { expirationTtl: TTL });
  } catch {}
  return row;
}

export async function getProgress(env, id) {
  if (!hasProgressStore(env) || !id) return null;
  try {
    return await env.GC_HISTORY.get(PREFIX + id, "json");
  } catch {
    return null;
  }
}

export async function clearProgress(env, id) {
  if (!hasProgressStore(env) || !id) return;
  try {
    await env.GC_HISTORY.delete(PREFIX + id);
  } catch {}
}
