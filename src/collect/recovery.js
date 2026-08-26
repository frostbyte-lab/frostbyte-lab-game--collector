/**
 * Recovery Engine — coba pulihkan asset gagal sebelum stillMissing.
 * Strategi: strip signed query, alternate extensions, origin path, runtime body reuse.
 */
import { safe } from "../lib/safe.js";
import { isExcluded, classifyResource } from "../classify/resource.js";
import { classifySlotSubfolder, folderOf } from "../classify/slot-folder.js";
import { verifyDownload, normalizeUrl, sha256 } from "../offline/strict-collector.js";
import { MAX_SINGLE_FILE, MAX_RAW_TOTAL, sumZipFilesBytes } from "./limits.js";
import { guessTypeFromUrl } from "./urls.js";

const SIGN_QUERY = /([?&])(sign|signature|sig|token|expires|exp|e|t|auth|key)=[^&]*/gi;

/** Hasilkan kandidat URL recovery dari URL gagal */
export function recoveryCandidates(url) {
  const out = [];
  const seen = new Set();
  const add = (u) => {
    if (!u || seen.has(u)) return;
    try {
      const abs = new URL(u).href;
      if (!abs.startsWith("http")) return;
      seen.add(abs);
      out.push(abs);
    } catch {}
  };

  add(url);
  try {
    const u = new URL(url);
    // Strip sign/token query
    let q = u.search.replace(SIGN_QUERY, "").replace(/[?&]$/, "").replace(/^\?&/, "?").replace(/\?$/, "");
    u.search = q.startsWith("?") || q === "" ? q : "?" + q.replace(/^\?/, "");
    // simpler: rebuild without known params
    const params = new URLSearchParams(u.search);
    ["sign", "signature", "sig", "token", "expires", "exp", "e", "t", "auth", "key", "Signature", "Expires"].forEach((k) => {
      params.delete(k);
      params.delete(k.toLowerCase());
    });
    const cleaned = u.origin + u.pathname + (params.toString() ? "?" + params.toString() : "");
    add(cleaned);
    add(u.origin + u.pathname);

    // Alternate extensions for images
    const path = u.pathname;
    const m = path.match(/^(.*)\.(png|jpe?g|webp|gif)$/i);
    if (m) {
      for (const ext of ["png", "jpg", "jpeg", "webp", "gif"]) {
        if (!path.toLowerCase().endsWith("." + ext)) {
          add(u.origin + m[1] + "." + ext);
        }
      }
    }
  } catch {}
  return out;
}

/**
 * @param {Array<{url:string, error?:string}>} failed
 * @param {object} ctx
 * @param {Set<string>} ctx.seen
 * @param {object} ctx.zipFiles
 * @param {Array} ctx.manifest
 * @param {string} ctx.baseHref
 * @param {Map<string, Uint8Array>} [ctx.runtimeBodies] url -> body captured at runtime
 * @param {Map<string, string>} [ctx.hashIndex]
 * @param {number} [ctx.maxRecover=40]
 */
export async function runRecoveryEngine(failed, ctx = {}) {
  const {
    seen,
    zipFiles,
    manifest,
    baseHref,
    runtimeBodies = new Map(),
    hashIndex = new Map(),
    maxRecover = 40
  } = ctx;

  const report = {
    attempted: 0,
    recovered: 0,
    failed: 0,
    stillMissing: [],
    methods: {}
  };

  const list = (failed || []).filter((x) => x && x.url).slice(0, maxRecover * 2);

  for (const item of list) {
    if (report.recovered + report.failed >= maxRecover) {
      report.stillMissing.push(item);
      continue;
    }
    let abs = item.url;
    try {
      abs = new URL(item.url, baseHref || undefined).href;
    } catch {
      report.stillMissing.push({ ...item, reason: "bad-url" });
      continue;
    }
    if (seen.has(abs) && !item.force) {
      continue;
    }
    if (isExcluded(abs)) {
      continue;
    }

    // 1) Runtime body reuse
    if (runtimeBodies.has(abs) || [...runtimeBodies.keys()].some((k) => k.split("?")[0] === abs.split("?")[0])) {
      let body = runtimeBodies.get(abs);
      let srcUrl = abs;
      if (!body) {
        for (const [k, v] of runtimeBodies) {
          if (k.split("?")[0] === abs.split("?")[0]) {
            body = v;
            srcUrl = k;
            break;
          }
        }
      }
      if (body && body.byteLength) {
        const ok = storeRecovered(body, srcUrl, "runtime-capture", abs, ctx, report);
        if (ok) continue;
      }
    }

    // 2) Try candidate URLs
    const candidates = recoveryCandidates(abs);
    let recovered = false;
    for (const cand of candidates) {
      if (seen.has(cand) && cand !== abs) continue;
      report.attempted++;
      try {
        const res = await fetch(cand, {
          headers: {
            "User-Agent": "GameCollectorPro-Recovery/1.0",
            Accept: "*/*",
            Referer: baseHref || undefined
          },
          redirect: "follow"
        });
        if (!res.ok) continue;
        const buf = new Uint8Array(await res.arrayBuffer());
        if (!buf.byteLength || buf.byteLength > MAX_SINGLE_FILE) continue;
        if (sumZipFilesBytes(zipFiles) + buf.byteLength > MAX_RAW_TOTAL) break;

        const ct = res.headers.get("content-type") || "";
        const expectedExt = (normalizeUrl(cand)?.localName || "").split(".").pop() || "";
        const verified = verifyDownload(res, buf, expectedExt);
        if (!verified.ok) continue;

        const method = cand === abs ? "retry" : cand.split("?")[0] === abs.split("?")[0] ? "strip-query" : "alt-url";
        storeRecovered(buf, cand, method, abs, ctx, report, verified, ct);
        recovered = true;
        break;
      } catch (_) {}
    }

    if (!recovered) {
      report.failed++;
      report.stillMissing.push({
        url: abs,
        error: item.error || "recovery-failed",
        collectStatus: item.collectStatus || "DOWNLOAD_FAILED"
      });
    }
  }

  return report;
}

function storeRecovered(buf, sourceUrl, method, originalUrl, ctx, report, verified = null, ct = "") {
  const { seen, zipFiles, manifest, hashIndex } = ctx;
  const buffer = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!buffer.byteLength) return false;

  let hash = verified?.hash;
  try {
    if (!hash) hash = sha256(buffer);
  } catch (_) {}

  if (hash && hashIndex && hashIndex.has(hash)) {
    const existing = hashIndex.get(hash);
    seen.add(originalUrl);
    seen.add(sourceUrl);
    manifest.push({
      url: originalUrl,
      localPath: existing,
      size: buffer.byteLength,
      recovered: true,
      recoveryMethod: method + "+dedup",
      duplicateOf: existing,
      hash,
      collectStatus: "RECOVERED"
    });
    report.recovered++;
    report.methods[method] = (report.methods[method] || 0) + 1;
    return true;
  }

  const type = guessTypeFromUrl(sourceUrl, ct || "");
  const classified = classifyResource(sourceUrl, type, ct || "", "");
  if (classified.category === "api" && !/image|audio|font|javascript|css/i.test(ct || type)) {
    // jangan recovery endpoint API murni sebagai asset
    return false;
  }
  const slot = classified.category === "game" ? classifySlotSubfolder(sourceUrl, type, ct) : { sub: null };
  const folder = folderOf(type, classified.category === "api" ? "game" : classified.category, slot.sub);
  let name = safe(new URL(sourceUrl).pathname.split("/").pop() || "file");
  name = name.split("?")[0].split("#")[0];
  if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
    if (type === "script") name += ".js";
    else if (type === "stylesheet") name += ".css";
    else if (type === "image") name += ".png";
    else name += ".bin";
  }
  if (hash && sourceUrl.includes("?")) {
    const ext = (name.match(/\.([a-z0-9]{1,8})$/i) || [])[1] || "bin";
    name = "sha256-" + hash.slice(0, 16) + "." + ext;
  }
  const localPath = `${folder}/${String(manifest.length + 1).padStart(4, "0")}-rec-${name}`;
  zipFiles[localPath] = buffer;
  if (hash && hashIndex) hashIndex.set(hash, localPath);
  seen.add(originalUrl);
  seen.add(sourceUrl);
  manifest.push({
    url: originalUrl,
    sourceUrl,
    type,
    contentType: ct,
    localPath,
    size: buffer.byteLength,
    category: classified.category === "api" ? "game" : classified.category,
    recovered: true,
    recoveryMethod: method,
    hash: hash || null,
    collectStatus: "RECOVERED"
  });
  report.recovered++;
  report.methods[method] = (report.methods[method] || 0) + 1;
  return true;
}
