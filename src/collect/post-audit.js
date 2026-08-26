/**
 * Post-collect audit: scan ulang http(s) di paket → klasifikasi
 * Target offline asset: https static asset remaining = 0
 */
import { isExcluded, classifyResource, STRICT_STATUS } from "../classify/resource.js";
import { extractReferencedUrls } from "./urls.js";

function decodeText(data) {
  try {
    return new TextDecoder().decode(data);
  } catch {
    return "";
  }
}

function basename(u) {
  try {
    return new URL(u).pathname.split("/").pop() || "";
  } catch {
    return String(u || "").split("?")[0].split("/").pop() || "";
  }
}

/**
 * @param {Record<string, Uint8Array>} zipFiles
 * @param {Array} manifest
 * @param {Set<string>} seen
 * @param {string} baseUrl
 */
export function postCollectAudit(zipFiles, manifest, seen, baseUrl) {
  const report = {
    scannedFiles: 0,
    externalFound: 0,
    unresolvedAssets: [],
    apis: [],
    tracking: [],
    ignored: [],
    rewrittenOk: 0,
    httpsAssetRemaining: 0,
    byStatus: {}
  };

  const knownLocal = new Set();
  const knownBare = new Set();
  for (const r of manifest || []) {
    if (r.url) knownLocal.add(r.url);
    if (r.localPath) {
      knownLocal.add(r.localPath);
      knownBare.add(String(r.localPath).split("/").pop());
    }
  }
  for (const k of Object.keys(zipFiles || {})) {
    knownLocal.add(k);
    knownBare.add(k.split("/").pop());
  }

  const textKeys = Object.keys(zipFiles || {}).filter(
    (k) =>
      /\.(html?|js|mjs|css|json|txt|xml|map)$/i.test(k) ||
      k === "index.html" ||
      /manifest/i.test(k)
  );

  const external = new Set();

  for (const key of textKeys) {
    const text = decodeText(zipFiles[key]);
    if (!text || text.length > 2_000_000) continue;
    report.scannedFiles++;

    try {
      for (const u of extractReferencedUrls(text, baseUrl || "https://local.invalid/")) {
        if (/^https?:\/\//i.test(u)) external.add(u);
      }
    } catch {
      /* ignore */
    }

    const re = /https?:\/\/[^\s"'`<>)\\]+/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      let u = m[0].replace(/[.,;)]+$/, "");
      if (u.length < 12) continue;
      if (/w3\.org\/2000\/svg/i.test(u)) {
        report.ignored.push({ url: u, status: STRICT_STATUS.SVG_NAMESPACE });
        continue;
      }
      external.add(u);
    }
  }

  report.externalFound = external.size;

  for (const u of external) {
    if (isExcluded(u)) {
      report.tracking.push({ url: u, status: STRICT_STATUS.TRACKING });
      continue;
    }

    const bare = basename(u);
    const collected =
      (seen && seen.has(u)) ||
      knownLocal.has(u) ||
      (bare && knownBare.has(bare)) ||
      (manifest || []).some((r) => {
        if (!r.url) return false;
        if (r.url === u) return true;
        try {
          return new URL(r.url).pathname === new URL(u).pathname;
        } catch {
          return false;
        }
      });

    if (collected) {
      report.rewrittenOk++;
      continue;
    }

    const classified = classifyResource(u, "fetch", "", "");
    const item = {
      url: u.slice(0, 400),
      status: classified.status,
      reason: classified.reason,
      category: classified.category
    };

    if (
      classified.status === STRICT_STATUS.API ||
      classified.status === STRICT_STATUS.SOCKET ||
      classified.category === "api" ||
      /\/web-api\/|\/game-api\/|\/api\/|api\./i.test(u)
    ) {
      report.apis.push(item);
    } else if (classified.status === STRICT_STATUS.TRACKING) {
      report.tracking.push(item);
    } else if (classified.status === STRICT_STATUS.SVG_NAMESPACE) {
      report.ignored.push(item);
    } else {
      report.unresolvedAssets.push(item);
    }
  }

  const failed = (manifest || []).filter(
    (r) =>
      r.collectStatus === STRICT_STATUS.DOWNLOAD_FAILED ||
      r.status === STRICT_STATUS.DOWNLOAD_FAILED ||
      (typeof r.httpStatus === "number" && r.httpStatus >= 400)
  );
  report.downloadFailed = failed.map((r) => ({
    url: (r.url || "").slice(0, 300),
    httpStatus: r.httpStatus || r.status,
    collectStatus: STRICT_STATUS.DOWNLOAD_FAILED,
    note: "DOWNLOAD_FAILED ≠ API"
  }));

  report.httpsAssetRemaining = report.unresolvedAssets.length;
  report.byStatus = {
    unresolvedAssets: report.unresolvedAssets.length,
    httpsAssetRemaining: report.httpsAssetRemaining,
    apis: report.apis.length,
    tracking: report.tracking.length,
    downloadFailed: report.downloadFailed.length,
    ignored: report.ignored.length,
    alreadyCollected: report.rewrittenOk
  };

  // Offline asset OK = 0 unresolved static https (API may remain for hybrid)
  report.ok = report.httpsAssetRemaining === 0;
  report.offlineAssetReady = report.ok;
  report.hybridSuggested = report.apis.length > 0;

  return report;
}

export function formatCollectAuditSummary(audit) {
  if (!audit) return "";
  const lines = [
    "## Post-collect audit",
    `- Scanned text files: ${audit.scannedFiles}`,
    `- External URLs found in sources: ${audit.externalFound}`,
    `- HTTPS static asset remaining: ${audit.httpsAssetRemaining ?? audit.byStatus?.unresolvedAssets ?? 0}`,
    `- Unresolved static assets: ${audit.byStatus?.unresolvedAssets ?? 0}`,
    `- API/backend (hybrid OK): ${audit.byStatus?.apis ?? 0}`,
    `- Tracking skipped: ${audit.byStatus?.tracking ?? 0}`,
    `- Download failed (≠ API): ${audit.byStatus?.downloadFailed ?? 0}`,
    `- Offline asset ready (https asset = 0): ${audit.offlineAssetReady || audit.ok ? "YES" : "NO"}`,
    `- Hybrid suggested: ${audit.hybridSuggested ? "YES" : "NO"}`
  ];
  if (audit.unresolvedAssets?.length) {
    lines.push("", "### Unresolved assets (sample)");
    audit.unresolvedAssets.slice(0, 15).forEach((a) => {
      lines.push(`- ${a.url}`);
    });
  }
  if (audit.downloadFailed?.length) {
    lines.push("", "### Download failed (not classified as API)");
    audit.downloadFailed.slice(0, 10).forEach((a) => {
      lines.push(`- [${a.httpStatus}] ${a.url}`);
    });
  }
  return lines.join("\n");
}
