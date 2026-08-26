/**
 * Static analyzer — discover dependencies without browser.
 * Scans HTML/CSS/JS/JSON/manifest/SW references from a seed HTML or ZIP texts.
 */
import { extractReferencedUrls, looksLikeStaticAsset } from "./urls.js";
import { isExcluded } from "../classify/resource.js";
import { extractHybridAssetUrls } from "../package/hybrid-cdn-fix.js";

/**
 * @param {string} html
 * @param {string} baseHref
 * @returns {{ urls: string[], swScripts: string[], wasm: string[], manifests: string[] }}
 */
export function staticAnalyzeHtml(html, baseHref) {
  const urls = new Set();
  const swScripts = [];
  const wasm = [];
  const manifests = [];

  if (!html) return { urls: [], swScripts, wasm, manifests };

  for (const u of extractReferencedUrls(html, baseHref)) {
    if (!isExcluded(u)) urls.add(u);
  }
  for (const u of extractHybridAssetUrls(html)) {
    if (!isExcluded(u) && looksLikeStaticAsset(u)) urls.add(u);
  }

  // service worker registration
  const swRe = /navigator\.serviceWorker\.register\s*\(\s*['"]([^'"]+)['"]/gi;
  let m;
  while ((m = swRe.exec(html))) {
    try {
      const abs = new URL(m[1], baseHref).href;
      swScripts.push(abs);
      urls.add(abs);
    } catch {}
  }
  // link rel manifest
  const manRe = /<link[^>]+rel=["']manifest["'][^>]+href=["']([^"']+)["']/gi;
  while ((m = manRe.exec(html))) {
    try {
      const abs = new URL(m[1], baseHref).href;
      manifests.push(abs);
      urls.add(abs);
    } catch {}
  }
  // wasm
  const wasmRe = /['"]([^'"]+\.wasm(?:\?[^'"]*)?)['"]/gi;
  while ((m = wasmRe.exec(html))) {
    try {
      const abs = new URL(m[1], baseHref).href;
      if (abs.startsWith("http")) {
        wasm.push(abs);
        urls.add(abs);
      }
    } catch {}
  }

  return {
    urls: [...urls],
    swScripts,
    wasm,
    manifests
  };
}

/**
 * Expand static scan over already-downloaded text assets in zipFiles.
 */
export function staticAnalyzeZip(zipFiles, baseHref) {
  const all = new Set();
  const swScripts = [];
  const wasm = [];
  for (const [key, data] of Object.entries(zipFiles || {})) {
    if (!/\.(html?|js|mjs|css|json)$/i.test(key) && !/service.?worker|sw\.js/i.test(key)) continue;
    try {
      const t = typeof data === "string" ? data : new TextDecoder().decode(data);
      if (t.length > 2_000_000) continue;
      const r = staticAnalyzeHtml(t, baseHref);
      r.urls.forEach((u) => all.add(u));
      swScripts.push(...r.swScripts);
      wasm.push(...r.wasm);
      if (/service.?worker|sw\.js/i.test(key) || /precache|workbox/i.test(t)) {
        for (const u of extractReferencedUrls(t, baseHref)) all.add(u);
      }
    } catch (_) {}
  }
  return {
    urls: [...all].filter((u) => !isExcluded(u)),
    swScripts: [...new Set(swScripts)],
    wasm: [...new Set(wasm)]
  };
}
