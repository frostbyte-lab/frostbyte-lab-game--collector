/**
 * URL → localPath map + collect status report.
 */
export function buildUrlMap(manifest) {
  const map = {};
  const byStatus = {};
  for (const r of manifest || []) {
    if (!r || !r.url) continue;
    map[r.url] = {
      localPath: r.localPath || null,
      collectStatus: r.collectStatus || r.strictStatus || (r.localPath ? "DOWNLOADED" : "UNKNOWN"),
      category: r.category || null,
      size: r.size || 0,
      hash: r.hash || null,
      recovered: !!r.recovered,
      duplicateOf: r.duplicateOf || null
    };
    const st = map[r.url].collectStatus;
    byStatus[st] = (byStatus[st] || 0) + 1;
  }
  return { map, byStatus, total: Object.keys(map).length };
}

export function formatStatusReport({ fillReport, recoveryReport, queueInfo, audit, urlMap }) {
  return {
    version: 1,
    fill: fillReport
      ? {
          fetched: fillReport.fetched || 0,
          failed: fillReport.failed || 0,
          duplicates: fillReport.duplicates || 0,
          passes: fillReport.passes || 0,
          stillMissing: (fillReport.stillMissing || []).length
        }
      : null,
    recovery: recoveryReport
      ? {
          recovered: recoveryReport.recovered || 0,
          failed: recoveryReport.failed || 0,
          methods: recoveryReport.methods || {},
          stillMissing: (recoveryReport.stillMissing || []).length
        }
      : null,
    queue: queueInfo || null,
    audit: audit
      ? {
          unresolvedAssets: audit.unresolvedAssets?.length || 0,
          apis: audit.apis?.length || 0,
          tracking: audit.tracking?.length || 0
        }
      : null,
    urlMapTotals: urlMap?.byStatus || {},
    statuses: [
      "DISCOVERED",
      "DOWNLOADED",
      "VERIFIED",
      "RECOVERED",
      "DUPLICATE",
      "DOWNLOAD_FAILED",
      "INVALID_RESPONSE",
      "UNRESOLVED"
    ]
  };
}
