/**
 * Real progress collect — simpan fase di KV (GC_HISTORY) agar UI bisa poll.
 * Key: prog:{id}  — progress + optional screenshot (jpeg base64)
 * Key: stop:{id}  — flag Stop Capture
 * TTL: 30 menit
 */

const PREFIX = "prog:";
const STOP_PREFIX = "stop:";
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
    recentFiles: Array.isArray(data.recentFiles) ? data.recentFiles.slice(0, 40) : null,
    schema: data.schema || null,
    completeness: data.completeness || null,
    suggestions: Array.isArray(data.suggestions) ? data.suggestions.slice(0, 12) : null,
    ts: new Date().toISOString(),
    done: Boolean(data.done),
    error: data.error || null,
    screenshot: data.screenshot || null,
    stopRequested: Boolean(data.stopRequested)
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

/** Minta collect berhenti lebih awal (Stop Capture) */
export async function requestStop(env, id) {
  if (!hasProgressStore(env) || !id) return false;
  try {
    await env.GC_HISTORY.put(STOP_PREFIX + id, "1", { expirationTtl: TTL });
    const cur = (await getProgress(env, id)) || { id, pct: 0, phase: "stopping" };
    await setProgress(env, id, {
      ...cur,
      phase: "stopping",
      label: "Stop diminta — packing resource yang sudah ada...",
      stopRequested: true
    });
    return true;
  } catch {
    return false;
  }
}

export async function isStopRequested(env, id) {
  if (!hasProgressStore(env) || !id) return false;
  try {
    const v = await env.GC_HISTORY.get(STOP_PREFIX + id);
    return v === "1";
  } catch {
    return false;
  }
}

export async function clearStop(env, id) {
  if (!hasProgressStore(env) || !id) return;
  try {
    await env.GC_HISTORY.delete(STOP_PREFIX + id);
  } catch {}
}
