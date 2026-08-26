/**
 * Offline Super Engine — readiness + bootstrap inject + API completeness.
 * Target: preview/APK mendekati offline-total (asset lokal + session mock).
 */
import { strToU8 } from "fflate";

const CDN_HOST_RE = /eajzzxhro\.com|static\.[a-z0-9.-]+\.(com|net|io)/i;
const API_PATH_RE =
  /verifysession|gamewallet|gameinfo|gamedata|\/web-api\/|\/game-api\/|\/spin\b|\/balance\b|\/session\b|\/bet\b/i;

/**
 * Build deep offline readiness report from zip + manifest + apiMap + hybrid + audit
 */
export function buildOfflineSuperReport({
  zipFiles = {},
  manifest = [],
  apiMap = null,
  hybrid = null,
  collectAudit = null
} = {}) {
  const keys = Object.keys(zipFiles || {});
  const png = keys.filter((k) => /\.png$/i.test(k)).length;
  const js = keys.filter((k) => /\.(js|mjs)$/i.test(k)).length;
  const hasIndex = keys.some((k) => /(^|\/)index\.html$/i.test(k));
  const eajzz = keys.filter((k) => /assets\/eajzz\//i.test(k)).length;

  const apiEndpoints = (apiMap && apiMap.endpoints) || [];
  const withSnap = apiEndpoints.filter((e) => e.hasSnapshot).length;
  const kinds = {};
  for (const e of apiEndpoints) {
    kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  }

  const unresolved =
    (collectAudit && (collectAudit.unresolvedAssets || []).length) ||
    (collectAudit && collectAudit.byStatus && collectAudit.byStatus.unresolvedAssets) ||
    0;
  const trackingLeft =
    (collectAudit && collectAudit.byStatus && collectAudit.byStatus.tracking) || 0;
  const downloadFailed =
    (collectAudit && collectAudit.byStatus && collectAudit.byStatus.downloadFailed) ||
    manifest.filter((r) => r.collectStatus === "DOWNLOAD_FAILED").length;

  // --- Rumus 5 v3: skor jujur ---
  // has_real_* = endpoint kind ada + snapshot (bukan synthetic template)
  const realByKind = (kind) =>
    apiEndpoints.some(
      (e) =>
        e &&
        e.kind === kind &&
        e.hasSnapshot &&
        e.snapshot &&
        !e.synthetic &&
        e.confidence !== "synthetic"
    );
  const has_real_session = realByKind("session") || realByKind("init");
  const has_real_spin = realByKind("spin");
  const has_real_balance = realByKind("balance");
  const anyRealSnap = apiEndpoints.some(
    (e) => e && e.hasSnapshot && e.snapshot && !e.synthetic
  );
  const snapshot_quality = anyRealSnap ? "REAL" : "SYNTHETIC";

  // Score v3 (prioritas offline super):
  // +40 assets/eajzz > 10 | +30 real session | +20 real spin | +10 no unresolved
  // + bonus kecil index/png agar paket kosong tidak skor 0 palsu "bagus"
  let score = 0;
  if (eajzz > 10 || ((hybrid && hybrid.downloaded) || 0) > 10) score += 40;
  else if (eajzz >= 1 || (hybrid && hybrid.downloaded > 0)) score += 20;
  if (has_real_session) score += 30;
  if (has_real_spin) score += 20;
  if (unresolved === 0) score += 10;
  else if (unresolved <= 3) score += 4;
  // bonus kecil
  if (hasIndex) score += 5;
  if (png >= 3) score += 5;
  if (has_real_balance) score += 5;
  if (apiEndpoints.length >= 3) score += 5;
  score = Math.min(100, score);

  let grade = "F";
  if (score >= 90) grade = "A";
  else if (score >= 75) grade = "B";
  else if (score >= 50) grade = "C";
  else if (score >= 40) grade = "D";

  const blockers = [];
  if (!hasIndex) blockers.push("Tidak ada index.html");
  if (png === 0) blockers.push("Tidak ada gambar di ZIP");
  if (eajzz < 10 && ((hybrid && hybrid.downloaded) || 0) < 10)
    blockers.push("assets/eajzz kurang dari 10 (hybrid CDN belum kuat)");
  if (!has_real_session)
    blockers.push("Belum ada snapshot session/init REAL — Collect Wait 20 + spins 3");
  if (!has_real_spin)
    blockers.push("Belum ada snapshot spin REAL — naikkan auto_spins");
  if (unresolved > 0)
    blockers.push(unresolved + " asset masih URL absolut (perlu hybrid/collect ulang)");
  if (downloadFailed > 0)
    blockers.push(downloadFailed + " download gagal (bukan API)");

  const recommendations = [];
  if (!has_real_session || !has_real_spin)
    recommendations.push("Collect ulang: Wait 20s + Auto-spins 3 (capture session/spin)");
  if (eajzz < 10)
    recommendations.push("Hybrid CDN: unduh ?sign= PNG ke assets/eajzz/ lalu rewrite");
  if (unresolved > 0)
    recommendations.push("Siapkan Offline / Custom API + hybrid rewrite sebelum klaim offline");
  if (score >= 75)
    recommendations.push("Grade A/B — uji Sandbox; SW cache siap untuk preview/APK");
  else
    recommendations.push("Score < 75 — jangan klaim offline 100%; collect/repair dulu");

  return {
    version: 3,
    engine: "offline-super",
    formula: "rumus-offline-v3",
    generatedAt: new Date().toISOString(),
    score,
    grade,
    status:
      score >= 75 ? "READY" : score >= 50 ? "PARTIAL" : "NOT_READY",
    has_real_session,
    has_real_spin,
    has_real_balance,
    snapshot_quality,
    assets: {
      totalFiles: keys.length,
      indexHtml: hasIndex,
      png,
      js,
      eajzzLocal: eajzz,
      hybridDownloaded: (hybrid && hybrid.downloaded) || 0,
      trackingRemoved: (hybrid && hybrid.trackingRemoved) || 0
    },
    api: {
      endpoints: apiEndpoints.length,
      withSnapshot: withSnap,
      byKind: kinds,
      note:
        snapshot_quality === "REAL"
          ? "Snapshot REAL dipakai dulu di Sandbox"
          : "Hanya template/synthetic — quality terbatas"
    },
    audit: {
      unresolvedAssets: unresolved,
      tracking: trackingLeft,
      downloadFailed
    },
    blockers,
    recommendations,
    checklist7: {
      offlineSuperJson: true,
      scoreGte75: score >= 75,
      gradeAB: grade === "A" || grade === "B",
      hasRealSession: has_real_session,
      eajzzGte10: eajzz >= 10 || ((hybrid && hybrid.downloaded) || 0) >= 10,
      apiEndpointsGte3: apiEndpoints.length >= 3,
      classifyOk: true
    },
    philosophy:
      "Offline 100% murni server-based = mustahil. Target: asset lokal + snapshot API + mock kritis. Score jujur (has_real_*)."
  };
}

/**
 * Inject minimal offline bootstrap into index.html (hint + __GC_OFFLINE_SUPER__).
 * Does not replace full sandbox bridge (that is injected at preview time).
 */
export function injectOfflineBootstrap(html, superReport) {
  if (!html || typeof html !== "string") return html;
  if (/__GC_OFFLINE_SUPER__/i.test(html)) return html;
  const boot = `<script data-gc-offline-super>
window.__GC_OFFLINE_SUPER__=${JSON.stringify({
    score: superReport.score,
    grade: superReport.grade,
    status: superReport.status,
    v: 3
  })};
console.info("[GC Offline Super]", window.__GC_OFFLINE_SUPER__);
</script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, "<head$1>" + boot);
  }
  return boot + html;
}

/**
 * Ensure critical API kinds exist in api-map (inject template endpoints if missing)
 */
export function ensureCriticalApiMocks(apiMap) {
  if (!apiMap || !Array.isArray(apiMap.endpoints)) return apiMap;
  const need = ["session", "init", "balance", "spin"];
  const have = new Set(apiMap.endpoints.map((e) => e.kind));
  const templates = {
    session: {
      path: "/verifysession",
      pathLower: "/verifysession",
      kind: "session",
      hasSnapshot: false,
      mockTemplate: {
        ok: true,
        err: null,
        error: 0,
        code: 0,
        __gcMock: true,
        dt: { si: "gc-offline", tk: "gc-token", bl: 100000 },
        data: { si: "gc-offline", token: "gc-token", balance: 100000 },
        session: { id: "gc-offline", ok: true },
        token: "gc-token",
        balance: 100000,
        bl: 100000
      }
    },
    init: {
      path: "/gameinfo",
      pathLower: "/gameinfo",
      kind: "init",
      hasSnapshot: false,
      mockTemplate: {
        ok: true,
        err: null,
        __gcMock: true,
        dt: { game: "offline", bl: 100000 },
        data: { gameInfo: { offline: true }, balance: 100000 },
        balance: 100000,
        bl: 100000
      }
    },
    balance: {
      path: "/gamewallet",
      pathLower: "/gamewallet",
      kind: "balance",
      hasSnapshot: false,
      mockTemplate: {
        ok: true,
        err: null,
        __gcMock: true,
        dt: { bl: 100000, currency: "IDR" },
        data: { balance: 100000 },
        balance: 100000,
        bl: 100000,
        credit: 100000
      }
    },
    spin: {
      path: "/spin",
      pathLower: "/spin",
      kind: "spin",
      hasSnapshot: false,
      mockTemplate: {
        ok: true,
        err: null,
        __gcMock: true,
        dt: {
          win: 0,
          bl: 100000,
          rl: [
            [1, 2, 3],
            [4, 5, 6],
            [7, 8, 9]
          ],
          si: "gc-offline"
        },
        win: 0,
        balance: 100000,
        bl: 100000,
        symbols: [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9]
        ]
      }
    }
  };
  for (const k of need) {
    if (!have.has(k)) {
      apiMap.endpoints.push({
        url: "https://gc.offline.local" + templates[k].path,
        ...templates[k],
        method_hint: "fetch",
        confidence: "synthetic",
        synthetic: true
      });
    }
  }
  apiMap.totals = apiMap.totals || {};
  apiMap.totals.endpoints = apiMap.endpoints.length;
  apiMap.totals.synthetic = apiMap.endpoints.filter((e) => e.synthetic).length;
  apiMap.version = Math.max(2, apiMap.version || 1);
  apiMap.offlineSuper = true;
  return apiMap;
}

export { CDN_HOST_RE, API_PATH_RE };
