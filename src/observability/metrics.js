const SUCCESS_STATUSES = new Set(["ok", "resume_ok"]);
const FAILURE_STATUSES = new Set(["blocked", "empty", "error", "failed"]);

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function aggregateHistoryMetrics(items = []) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  const byStatus = {};
  const byEngine = {};
  let success = 0;
  let failure = 0;
  let partial = 0;
  let totalFiles = 0;
  let totalZipBytes = 0;
  let scored = 0;
  let scoreSum = 0;

  for (const row of rows) {
    const status = String(row.status || "unknown");
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (SUCCESS_STATUSES.has(status)) success++;
    else if (FAILURE_STATUSES.has(status)) failure++;
    else if (/partial|incomplete/i.test(status)) partial++;
    totalFiles += finiteNumber(row.files);
    totalZipBytes += finiteNumber(row.zipSize);
    if (row.overallScore != null && Number.isFinite(Number(row.overallScore))) {
      scored++;
      scoreSum += Number(row.overallScore);
    }
    const engine = String(row.details?.engine || row.engine || "unknown");
    byEngine[engine] = (byEngine[engine] || 0) + 1;
  }

  return {
    sampleSize: rows.length,
    success,
    failure,
    partial,
    successRate: rows.length ? Math.round((success / rows.length) * 1000) / 10 : null,
    totalFiles,
    totalZipBytes,
    averageFiles: rows.length ? Math.round((totalFiles / rows.length) * 10) / 10 : 0,
    averageZipBytes: rows.length ? Math.round(totalZipBytes / rows.length) : 0,
    averageOverallScore: scored ? Math.round((scoreSum / scored) * 10) / 10 : null,
    byStatus,
    byEngine,
    generatedAt: new Date().toISOString()
  };
}

export default aggregateHistoryMetrics;
