import { fillMissingAssets } from "./fill-missing.js";
import { buildDependencyQueue } from "./queue.js";
import { isExcluded } from "../classify/resource.js";
import { extractReferencedUrls } from "./urls.js";

export const FILL_MISSING_V2_MAX_PER_PASS = 250;
export const FILL_MISSING_V2_MAX_PASSES = 8;

function collectTextDependencies(zipFiles, baseHref) {
  const urls = new Set();
  for (const [path, data] of Object.entries(zipFiles || {})) {
    if (!/\.(html?|js|mjs|css|json)$/i.test(path)) continue;
    try {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      if (text.length <= 2_000_000) {
        for (const url of extractReferencedUrls(text, baseHref)) urls.add(url);
      }
    } catch (_) {
      // Binary or malformed resources are ignored by the dependency scanner.
    }
  }
  return urls;
}

/**
 * Dependency-guided wrapper around the strict collector fill engine.
 * Seeds the fill queue from static files and runtime-discovered URLs, then
 * delegates verification, deduplication, classification and multi-pass fetches
 * to the existing implementation.
 */
export async function fillMissingAssetsV2(
  zipFiles,
  manifest,
  seen,
  targetHref,
  id,
  env,
  selectAllowed = null,
  options = {}
) {
  const maxPerPass = Math.min(
    FILL_MISSING_V2_MAX_PER_PASS,
    Math.max(1, Number(options.maxPerPass) || FILL_MISSING_V2_MAX_PER_PASS)
  );
  const maxPasses = Math.min(
    FILL_MISSING_V2_MAX_PASSES,
    Math.max(1, Number(options.maxPasses) || FILL_MISSING_V2_MAX_PASSES)
  );
  const runtimeUrls = Array.isArray(options.seedUrls) ? options.seedUrls : [];
  const dependencyQueue = buildDependencyQueue(zipFiles, seen, targetHref, runtimeUrls);
  const staticDependencies = collectTextDependencies(zipFiles, targetHref);
  const seedUrls = [...new Set([...dependencyQueue.pending, ...staticDependencies])].filter(
    (url) => !seen.has(url) && !isExcluded(url)
  );

  const report = await fillMissingAssets(
    zipFiles,
    manifest,
    seen,
    targetHref,
    id,
    env,
    selectAllowed,
    maxPerPass,
    maxPasses,
    seedUrls
  );

  return {
    ...report,
    version: "v2",
    maxPerPass,
    maxPasses,
    dependencyGuided: true,
    dependencySeeded: seedUrls.length,
    dependencyQueue: {
      discovered: dependencyQueue.discovered,
      pending: dependencyQueue.pending.length,
      seeded: seedUrls.length
    }
  };
}

export default fillMissingAssetsV2;
