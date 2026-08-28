import { safe } from "../lib/safe.js";
import { isExcluded, classifyResource } from "../classify/resource.js";
import { classifySlotSubfolder, folderOf } from "../classify/slot-folder.js";
import { shouldIncludeResource } from "../classify/select-filter.js";
import { extractReferencedUrls, guessTypeFromUrl } from "./urls.js";
import {
  MAX_SINGLE_FILE,
  MAX_RAW_TOTAL,
  sumZipFilesBytes,
  MAX_FILL_PER_PASS,
  MAX_FILL_PASSES,
  MAX_FILL_PER_PASS_CAP,
  MAX_FILL_PASSES_CAP
} from "./limits.js";
import { verifyDownload, normalizeUrl, sha256 } from "../offline/strict-collector.js";

/**
 * Multi-pass auto-fill: scan HTML/JS/CSS → fetch missing → scan newly fetched → pass 2.
 * @param {number} [maxPerPass=80]
 * @param {number} [maxPasses=4]
 */
export async function fillMissingAssets(
  zipFiles,
  manifest,
  seen,
  targetHref,
  id,
  env,
  selectAllowed = null,
  maxPerPass = MAX_FILL_PER_PASS,
  maxPasses = MAX_FILL_PASSES,
  seedUrls = []
) {
  const report = {
    scanned: 0,
    missingFound: 0,
    fetched: 0,
    failed: 0,
    duplicates: 0,
    stillMissing: [],
    passes: 0,
    perPass: []
  };

  const MAX_FILL = Math.min(MAX_FILL_PER_PASS_CAP, Math.max(20, Number(maxPerPass) || MAX_FILL_PER_PASS));
  const PASSES = Math.min(MAX_FILL_PASSES_CAP, Math.max(1, Number(maxPasses) || MAX_FILL_PASSES));

  // Content-hash index for dedup (signed URL variants → one local file)
  const hashIndex = new Map();
  for (const [path, data] of Object.entries(zipFiles || {})) {
    if (!data || typeof data === "string") continue;
    try {
      const h = sha256(data instanceof Uint8Array ? data : new Uint8Array(data));
      if (h && !hashIndex.has(h)) hashIndex.set(h, path);
    } catch (_) {}
  }

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
    if (pass === 1) {
      for (const seed of seedUrls || []) {
        if (typeof seed === "string" && /^https?:\/\//i.test(seed)) needed.add(seed);
      }
    }
    for (const t of texts) {
      for (const u of extractReferencedUrls(t, targetHref)) needed.add(u);
    }
    let missing = [...needed].filter((u) => !seen.has(u) && !isExcluded(u));
    // Prioritas CDN asset host (public.*/static.*) yang tertulis di JS — sering miss di runtime singkat
    const prio = (u) => {
      const s = String(u).toLowerCase();
      // Signed game CDN (6 PNG di index, dll.) — paling dulu
      if (/eajzzxhro\.com/i.test(s) && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(s)) return 0;
      if (/[?&]sign=/i.test(s) && /\.(png|jpe?g|gif|webp|js|css)(\?|$)/i.test(s)) return 0;
      if (/public\./i.test(s) && /\.(png|jpe?g|gif|webp|svg|js|css|json|mp3|ogg|woff)/i.test(s)) return 1;
      if (/static\./i.test(s) && /\.(png|jpe?g|gif|webp|svg|js|css|json|mp3|ogg|woff)/i.test(s)) return 1;
      if (/\.(png|jpe?g|gif|webp|mp3|ogg|woff2?)/i.test(s)) return 2;
      if (/\.(js|mjs|css)/i.test(s)) return 3;
      return 4;
    };
    missing.sort((a, b) => prio(a) - prio(b));
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
            collectStatus: "INVALID_RESPONSE",
            pass,
            strict: true
          });
          continue;
        }
        // Content-hash dedup: same bytes already in ZIP (e.g. signed URL variants)
        if (verified.hash && hashIndex.has(verified.hash)) {
          const existing = hashIndex.get(verified.hash);
          seen.add(u);
          manifest.push({
            url: u,
            type,
            status: res.status,
            localPath: existing,
            size: buffer.byteLength,
            contentType: ct,
            category: classifyResource(u, type, ct, "").category,
            autoFilled: true,
            fillPass: pass,
            duplicateOf: existing,
            hash: verified.hash,
            strictStatus: "VERIFIED",
            collectStatus: "DUPLICATE"
          });
          report.duplicates++;
          passReport.fetched++;
          report.fetched++;
          continue;
        }
        let name = safe((new URL(u).pathname.split("/").pop() || "file").split("?")[0]);
        // Strip query from local filename (signed URL)
        name = name.split("?")[0].split("#")[0];
        if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
          if (type === "script") name += ".js";
          else if (type === "stylesheet") name += ".css";
          else if (type === "image") name += ".png";
          else if (type === "media") name += ".bin";
          else if (ct.includes("json")) name += ".json";
        }
        // Content-addressed name when URL is signed / query-heavy
        if (verified.hash && (/[?&](sign|signature|token|expires)=/i.test(u) || u.includes("?"))) {
          const ext = (name.match(/\.([a-z0-9]{1,8})$/i) || [])[1] || "bin";
          name = "sha256-" + verified.hash.slice(0, 16) + "." + ext;
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
        zipFiles[localPath] = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        if (verified.hash) hashIndex.set(verified.hash, localPath);
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
          signatureMatch: verified.signatureMatch,
          collectStatus: "VERIFIED"
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
