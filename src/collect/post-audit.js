/**
 * Post-collect audit: scan ulang http(s) di paket → klasifikasi
 * unresolved static asset vs API vs tracking.
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
    byStatus: {}
  };

  const knownLocal = new Set();
  for (const r of manifest || []) {
    if (r.url) knownLocal.add(r.url);
    if (r.localPath) knownLocal.add(r.localPath);
  }
  for (const k of Object.keys(zipFiles || {})) knownLocal.add(k);

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

    // Relative + absolute via extractor
    try {
      for (const u of extractReferencedUrls(text, baseUrl || "https://local.invalid/")) {
        if (/^https?:\/\//i.test(u)) external.add(u);
      }
    } catch {
      /* ignore */
    }

    // Raw absolute still in source after rewrite
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
    // Already collected?
    if (seen && seen.has(u)) {
      report.rewrittenOk++;
      continue;
    }
    const inManifest = (manifest || []).some((r) => r.url === u);
    if (inManifest) {
      report.rewrittenOk++;
      continue;
    }

    let pathname = "";
    try {
      pathname = new URL(u).pathname;
    } catch {
      /* ignore */
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
      classified.category === "api"
    ) {
      report.apis.push(item);
    } else if (classified.status === STRICT_STATUS.TRACKING) {
      report.tracking.push(item);
    } else if (classified.status === STRICT_STATUS.SVG_NAMESPACE) {
      report.ignored.push(item);
    } else {
      // Static asset still pointing online = unresolved
      report.unresolvedAssets.push(item);
    }
  }

  // Count download failures from manifest
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

  report.byStatus = {
    unresolvedAssets: report.unresolvedAssets.length,
    apis: report.apis.length,
    tracking: report.tracking.length,
    downloadFailed: report.downloadFailed.length,
    ignored: report.ignored.length,
    alreadyCollected: report.rewrittenOk
  };

  report.ok =
    report.unresolvedAssets.length === 0 && report.downloadFailed.length === 0;

  return report;
}

/**
 * Build human-readable collect report section
 */
export function formatCollectAuditSummary(audit) {
  if (!audit) return "";
  const lines = [
    "## Post-collect audit",
    `- Scanned text files: ${audit.scannedFiles}`,
    `- External URLs found in sources: ${audit.externalFound}`,
    `- Unresolved static assets: ${audit.byStatus?.unresolvedAssets ?? 0}`,
    `- API/backend left online: ${audit.byStatus?.apis ?? 0}`,
    `- Tracking skipped: ${audit.byStatus?.tracking ?? 0}`,
    `- Download failed (≠ API): ${audit.byStatus?.downloadFailed ?? 0}`,
    `- Audit OK (0 unresolved asset): ${audit.ok ? "YES" : "NO"}`
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
