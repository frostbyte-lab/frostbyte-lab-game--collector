import { safe } from "../lib/safe.js";
import { isExcluded, classifyResource } from "../classify/resource.js";
import { classifySlotSubfolder, folderOf } from "../classify/slot-folder.js";
import { extractReferencedUrls, guessTypeFromUrl } from "./urls.js";
import { MAX_SINGLE_FILE, MAX_RAW_TOTAL, sumZipFilesBytes } from "./limits.js";

export async function fillMissingAssets(zipFiles, manifest, seen, targetHref, id, env) {
  const report = { scanned: 0, missingFound: 0, fetched: 0, failed: 0, stillMissing: [] };
  const texts = [];
  for (const [key, data] of Object.entries(zipFiles)) {
    if (!/\.(html?|js|mjs|css)$/i.test(key) && key !== "index.html") continue;
    try {
      texts.push(new TextDecoder().decode(data));
      report.scanned++;
    } catch {}
  }
  const needed = new Set();
  for (const t of texts) {
    for (const u of extractReferencedUrls(t, targetHref)) needed.add(u);
  }
  const missing = [...needed].filter(u => !seen.has(u) && !isExcluded(u));
  report.missingFound = missing.length;

  // Cap secondary fetches to stay within worker limits
  const MAX_FILL = 40;
  for (const u of missing.slice(0, MAX_FILL)) {
    try {
      const res = await fetch(u, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; GameCollectorPro/1.0)", "Accept": "*/*" },
        redirect: "follow"
      });
      if (!res.ok) {
        report.failed++;
        report.stillMissing.push({ url: u, error: "status " + res.status });
        continue;
      }
      const buffer = new Uint8Array(await res.arrayBuffer());
      if (!buffer.byteLength) {
        report.failed++;
        report.stillMissing.push({ url: u, error: "empty" });
        continue;
      }
      if (buffer.byteLength > MAX_SINGLE_FILE) {
        report.failed++;
        report.stillMissing.push({ url: u, error: "too-large-file" });
        continue;
      }
      if (sumZipFilesBytes(zipFiles) + buffer.byteLength > MAX_RAW_TOTAL) {
        report.stillMissing.push({ url: u, error: "raw-total-limit" });
        break;
      }
      const ct = res.headers.get("content-type") || "";
      const type = guessTypeFromUrl(u, ct);
      let name = safe(new URL(u).pathname.split("/").pop() || "file");
      if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
        if (type === "script") name += ".js";
        else if (type === "stylesheet") name += ".css";
        else if (type === "image") name += ".bin";
        else if (ct.includes("json")) name += ".json";
      }
      const classified = classifyResource(u, type, ct, "");
      const slot = classified.category === "game"
        ? classifySlotSubfolder(u, type, ct)
        : { sub: null, reason: "" };
      const folder = folderOf(type, classified.category, slot.sub);
      const localPath = `${folder}/${String(manifest.length + 1).padStart(4, "0")}-fill-${name}`;
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
        classifyReason: classified.reason + (slot.reason ? "+" + slot.reason : "") + "+auto-fill",
        autoFilled: true
      });
      report.fetched++;
    } catch (e) {
      report.failed++;
      report.stillMissing.push({ url: u, error: String(e.message || e).slice(0, 120) });
    }
  }
  for (const u of missing.slice(MAX_FILL)) {
    report.stillMissing.push({ url: u, error: "skipped-limit" });
  }
  return report;
}
