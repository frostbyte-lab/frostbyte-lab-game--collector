import { safe } from "../lib/safe.js";
import { isExcluded, classifyResource } from "../classify/resource.js";
import { classifySlotSubfolder, folderOf } from "../classify/slot-folder.js";
import { shouldIncludeResource } from "../classify/select-filter.js";
import { extractReferencedUrls, guessTypeFromUrl } from "./urls.js";
import { MAX_SINGLE_FILE, MAX_RAW_TOTAL, sumZipFilesBytes } from "./limits.js";
import { verifyDownload, normalizeUrl } from "../offline/strict-collector.js";

/**
 * Multi-pass auto-fill: scan HTML/JS/CSS → fetch missing → scan newly fetched → pass 2.
 * @param {number} [maxPerPass=40]
 * @param {number} [maxPasses=2]
 */
export async function fillMissingAssets(
  zipFiles,
  manifest,
  seen,
  targetHref,
  id,
  env,
  selectAllowed = null,
  maxPerPass = 40,
  maxPasses = 2
) {
  const report = {
    scanned: 0,
    missingFound: 0,
    fetched: 0,
    failed: 0,
    stillMissing: [],
    passes: 0,
    perPass: []
  };

  const MAX_FILL = Math.min(80, Math.max(10, Number(maxPerPass) || 40));
  const PASSES = Math.min(3, Math.max(1, Number(maxPasses) || 2));

  for (let pass = 1; pass <= PASSES; pass++) {
    const texts = [];
    for (const [key, data] of Object.entries(zipFiles)) {
      // Static recursive: HTML/CSS/JS + JSON (config/atlas/map sering berisi URL asset)
      if (!/\.(html?|js|mjs|css|json)$/i.test(key) && key !== "index.html") continue;
      try {
        const t = new TextDecoder().decode(data);
        if (t.length > 1_500_000) continue;
        texts.push(t);
        report.scanned++;
      } catch {}
    }

    const needed = new Set();
    for (const t of texts) {
      for (const u of extractReferencedUrls(t, targetHref)) needed.add(u);
    }
    const missing = [...needed].filter((u) => !seen.has(u) && !isExcluded(u));
    if (pass === 1) report.missingFound = missing.length;

    const passReport = { pass, attempted: 0, fetched: 0, failed: 0, skipped: 0 };
    let hitLimit = false;

    for (const u of missing.slice(0, MAX_FILL)) {
      passReport.attempted++;
      try {
        const res = await fetch(u, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; GameCollectorPro/1.0)",
            Accept: "*/*",
            Referer: targetHref || undefined
          },
          redirect: "follow"
        });
        if (!res.ok) {
          report.failed++;
          passReport.failed++;
          report.stillMissing.push({
            url: u,
            error: "status " + res.status,
            collectStatus: "DOWNLOAD_FAILED",
            note: "DOWNLOAD_FAILED ≠ API",
            pass
          });
          continue;
        }
        const buffer = new Uint8Array(await res.arrayBuffer());
        if (!buffer.byteLength) {
          report.failed++;
          passReport.failed++;
          report.stillMissing.push({ url: u, error: "empty", pass });
          continue;
        }
        if (buffer.byteLength > MAX_SINGLE_FILE) {
          report.failed++;
          passReport.failed++;
          report.stillMissing.push({ url: u, error: "too-large-file", pass });
          continue;
        }
        if (sumZipFilesBytes(zipFiles) + buffer.byteLength > MAX_RAW_TOTAL) {
          report.stillMissing.push({ url: u, error: "raw-total-limit", pass });
          hitLimit = true;
          break;
        }
        const ct = res.headers.get("content-type") || "";
        const type = guessTypeFromUrl(u, ct);
        // Strict verification (HTTP + content + signature + hash)
        const expectedExt = (normalizeUrl(u)?.localName || "").split(".").pop() || "";
        const verified = verifyDownload(res, buffer, expectedExt);
        if (!verified.ok) {
          report.failed++;
          passReport.failed++;
          report.stillMissing.push({
            url: u,
            error: verified.error || verified.status,
            pass,
            strict: true
          });
          continue;
        }
        let name = safe(new URL(u).pathname.split("/").pop() || "file");
        // Strip query from local filename (Rule 7)
        name = name.split("?")[0].split("#")[0];
        if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
          if (type === "script") name += ".js";
          else if (type === "stylesheet") name += ".css";
          else if (type === "image") name += ".bin";
          else if (ct.includes("json")) name += ".json";
        }
        const classified = classifyResource(u, type, ct, "");
        // Skip tracking / SVG namespace even if somehow reached here
        if (classified.status === "TRACKING" || classified.status === "SVG_NAMESPACE") {
          passReport.skipped++;
          continue;
        }
        const slot =
          classified.category === "game"
            ? classifySlotSubfolder(u, type, ct)
            : { sub: null, reason: "" };
        const folder = folderOf(type, classified.category, slot.sub);

        if (
          !shouldIncludeResource({
            category: classified.category,
            sub: slot.sub,
            folder,
            allowed: selectAllowed
          })
        ) {
          passReport.skipped++;
          continue;
        }

        const localPath = `${folder}/${String(manifest.length + 1).padStart(4, "0")}-fill${pass}-${name}`;
        zipFiles[localPath] = buffer;
        seen.add(u);
        manifest.push({
          url: u,
          type,
          status: res.status,
          localPath,
          size: buffer.byteLength,
          contentType: ct,
          category: classified.category,
          subCategory: slot.sub || null,
          classifyReason:
            classified.reason + (slot.reason ? "+" + slot.reason : "") + "+auto-fill-p" + pass,
          autoFilled: true,
          fillPass: pass,
          // Strict collector fields
          strictStatus: classified.status || "ASSET",
          hash: verified.hash || null,
          signature: verified.signature?.type || null,
          signatureMatch: verified.signatureMatch
        });
        report.fetched++;
        passReport.fetched++;
      } catch (e) {
        report.failed++;
        passReport.failed++;
        report.stillMissing.push({
          url: u,
          error: String(e.message || e).slice(0, 120),
          pass
        });
      }
    }

    for (const u of missing.slice(MAX_FILL)) {
      report.stillMissing.push({ url: u, error: "skipped-limit", pass });
      passReport.skipped++;
    }

    report.passes = pass;
    report.perPass.push(passReport);

    // Pass berikutnya hanya berguna jika ada fetch baru (JS/CSS baru mungkin punya ref)
    if (hitLimit || passReport.fetched === 0) break;
  }

  // Dedup stillMissing by url (keep last error)
  const byUrl = new Map();
  for (const row of report.stillMissing) {
    byUrl.set(row.url, row);
  }
  // Drop urls that were eventually fetched
  for (const u of seen) byUrl.delete(u);
  report.stillMissing = [...byUrl.values()];

  return report;
}
