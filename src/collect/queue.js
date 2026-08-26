/**
 * Explicit dependency queue — recursive discovery with honest stillMissing.
 */
import { isExcluded } from "../classify/resource.js";
import { extractReferencedUrls } from "./urls.js";

/**
 * Build dependency queue from zip text files + seed URLs.
 * @returns {{ pending: string[], seen: Set<string>, discovered: number }}
 */
export function buildDependencyQueue(zipFiles, seen, baseHref, seedUrls = []) {
  const pending = [];
  const push = (u) => {
    if (!u || seen.has(u) || isExcluded(u)) return;
    if (!u.startsWith("http://") && !u.startsWith("https://")) return;
    pending.push(u);
  };

  for (const u of seedUrls || []) push(u);

  for (const [key, data] of Object.entries(zipFiles || {})) {
    if (!/\.(html?|js|mjs|css|json)$/i.test(key) && key !== "index.html") continue;
    // Service worker filenames
    if (/sw\.js|service-worker|serviceworker/i.test(key) || /\.(html?|js|mjs|css|json)$/i.test(key)) {
      try {
        const t = typeof data === "string" ? data : new TextDecoder().decode(data);
        if (t.length > 2_000_000) continue;
        for (const u of extractReferencedUrls(t, baseHref)) push(u);
        // SW precache patterns
        const precache = t.matchAll(/["'](https?:\/\/[^"']+\.(?:png|jpe?g|gif|webp|js|css|woff2?|mp3|ogg|json|wasm)[^"']*)["']/gi);
        for (const m of precache) push(m[1]);
      } catch (_) {}
    }
  }

  // Dedup pending while preserving order
  const uniq = [];
  const inQ = new Set();
  for (const u of pending) {
    if (inQ.has(u) || seen.has(u)) continue;
    inQ.add(u);
    uniq.push(u);
  }
  return { pending: uniq, discovered: uniq.length };
}

/**
 * Drain queue description for reports (honest remaining).
 */
export function queueReport(pending, seen, fetched = 0, failed = 0) {
  return {
    queueRemaining: (pending || []).length,
    seen: seen?.size || 0,
    fetched,
    failed,
    stillPending: (pending || []).slice(0, 100).map((url) => ({ url, collectStatus: "DISCOVERED" })),
    note:
      (pending || []).length > 0
        ? "Antrian belum habis — pakai Resume / Recovery untuk sisa dependency"
        : "Antrian kosong atau semua URL sudah diproses"
  };
}
