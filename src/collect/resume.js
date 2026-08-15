/**
 * Resume / partial collect — fetch stillMissing URLs tanpa browser Playwright.
 * Dipakai setelah collect putus atau auto-fill belum selesai.
 */
import { safe } from "../lib/safe.js";
import { classifyResource } from "../classify/resource.js";
import { classifySlotSubfolder, folderOf } from "../classify/slot-folder.js";
import { MAX_SINGLE_FILE } from "./limits.js";

function guessType(url, ct = "") {
  const u = url.toLowerCase();
  const c = (ct || "").toLowerCase();
  if (c.includes("javascript") || /\.m?js($|\?)/i.test(u)) return "script";
  if (c.includes("css") || /\.css($|\?)/i.test(u)) return "stylesheet";
  if (c.includes("image") || /\.(png|jpe?g|gif|webp|svg|ico)($|\?)/i.test(u)) return "image";
  if (c.includes("audio") || c.includes("video") || /\.(mp3|ogg|wav|mp4|webm|m4a)($|\?)/i.test(u)) return "media";
  if (c.includes("font") || /\.(woff2?|ttf|otf)($|\?)/i.test(u)) return "font";
  if (c.includes("json") || /\.json($|\?)/i.test(u)) return "fetch";
  if (/\.html?($|\?)/i.test(u)) return "document";
  return "fetch";
}

/**
 * @param {Array<{url:string, reason?:string}>|string[]} stillMissing
 * @param {Set<string>} seen
 * @param {object} zipFiles - mutable map path -> Uint8Array
 * @param {Array} manifest - mutable
 * @param {string} baseHref
 * @param {number} maxFetch
 */
export async function resumeFetchMissing(stillMissing, seen, zipFiles, manifest, baseHref, maxFetch = 40) {
  const report = {
    attempted: 0,
    fetched: 0,
    failed: 0,
    skipped: 0,
    stillMissing: [],
    added: []
  };

  const list = (stillMissing || [])
    .map((x) => (typeof x === "string" ? { url: x } : x))
    .filter((x) => x && x.url && !String(x.url).startsWith("data:") && !String(x.url).startsWith("blob:"));

  let baseOrigin = "";
  try { baseOrigin = new URL(baseHref).origin; } catch {}

  for (const item of list) {
    if (report.fetched + report.failed >= maxFetch) {
      report.stillMissing.push(item);
      continue;
    }
    let abs = item.url;
    try {
      abs = new URL(item.url, baseHref || undefined).href;
    } catch {
      report.failed++;
      report.stillMissing.push({ ...item, reason: "bad-url" });
      continue;
    }
    if (seen.has(abs)) {
      report.skipped++;
      continue;
    }
    report.attempted++;
    try {
      const res = await fetch(abs, {
        headers: {
          "User-Agent": "GameCollectorPro-Resume/1.0",
          Accept: "*/*",
          ...(baseOrigin ? { Referer: baseHref } : {})
        },
        redirect: "follow"
      });
      if (!res.ok) {
        report.failed++;
        report.stillMissing.push({ url: abs, reason: "http-" + res.status });
        seen.add(abs);
        continue;
      }
      const ct = res.headers.get("content-type") || "";
      const buf = new Uint8Array(await res.arrayBuffer());
      if (!buf.byteLength) {
        report.failed++;
        report.stillMissing.push({ url: abs, reason: "empty" });
        seen.add(abs);
        continue;
      }
      if (buf.byteLength > MAX_SINGLE_FILE) {
        report.failed++;
        report.stillMissing.push({ url: abs, reason: "too-large" });
        seen.add(abs);
        continue;
      }

      const type = guessType(abs, ct);
      const classified = classifyResource(abs, type, ct, "");
      const sub = classified.category === "game" ? classifySlotSubfolder(abs, type, ct) : null;
      const folder = folderOf(type, classified.category, sub?.sub || null);
      let name = safe(new URL(abs).pathname.split("/").pop() || "file");
      if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
        if (type === "script") name += ".js";
        else if (type === "stylesheet") name += ".css";
        else if (type === "image") name += ".png";
        else if (type === "media") name += ".mp3";
        else if (ct.includes("json")) name += ".json";
      }
      const localPath = `${folder}/${String(manifest.length + 1).padStart(4, "0")}-${name}`;
      zipFiles[localPath] = buf;
      const entry = {
        url: abs,
        type,
        contentType: ct,
        status: res.status,
        size: buf.byteLength,
        localPath,
        category: classified.category,
        classifyReason: classified.reason,
        resumed: true
      };
      manifest.push(entry);
      seen.add(abs);
      report.fetched++;
      report.added.push({ url: abs, localPath, size: buf.byteLength });
    } catch (e) {
      report.failed++;
      report.stillMissing.push({ url: abs, reason: String(e.message || e).slice(0, 80) });
      seen.add(abs);
    }
  }

  return report;
}
