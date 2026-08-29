/**
 * Batas platform Worker + mode besar melalui GitHub Actions.
 * Unlimited produk ≠ infinite RAM satu request.
 */

export const MAX_SINGLE_FILE = 32 * 1024 * 1024;
export const MAX_RAW_TOTAL = 56 * 1024 * 1024;
export const MAX_ZIP_RESPONSE = 28 * 1024 * 1024;

export const UNLIMITED = {
  maxSingleFile: 80 * 1024 * 1024,
  maxRawTotal: 120 * 1024 * 1024,
  maxZipResponse: 50 * 1024 * 1024,
  fillPerPass: 400,
  fillPasses: 10,
  maxWaitSec: 180,
  maxSpins: 50
};

export const MAX_FILL_PER_PASS = 250;
export const MAX_FILL_PASSES = 8;
export const MAX_FILL_PER_PASS_CAP = 400;
export const MAX_FILL_PASSES_CAP = 12;

export function resolveLimits(env, opts = {}) {
  const unlimited = !!(opts.unlimited || opts.noLimit || opts.mode === "unlimited");
  if (unlimited) {
    return {
      mode: "unlimited-worker",
      maxSingleFile: 40 * 1024 * 1024,
      maxRawTotal: 72 * 1024 * 1024,
      maxZipResponse: 32 * 1024 * 1024,
      fillPerPass: 300,
      fillPasses: 8,
      maxWaitSec: UNLIMITED.maxWaitSec,
      maxSpins: UNLIMITED.maxSpins,
      preferGithubOnOverflow: true
    };
  }
  return {
    mode: "standard",
    maxSingleFile: MAX_SINGLE_FILE,
    maxRawTotal: MAX_RAW_TOTAL,
    maxZipResponse: MAX_ZIP_RESPONSE,
    fillPerPass: MAX_FILL_PER_PASS,
    fillPasses: MAX_FILL_PASSES,
    maxWaitSec: 120,
    maxSpins: 30
  };
}

export function tooLargeResponse(extra = {}) {
  return Response.json(
    {
      ok: false,
      error: "TOO_LARGE",
      code: "TOO_LARGE",
      message:
        "Paket melebihi kapasitas Worker. Gunakan Collect via GitHub Actions untuk package besar.",
      suggest: "github-actions",
      limits: {
        maxSingleFileMB: Math.round(MAX_SINGLE_FILE / 1024 / 1024),
        maxRawTotalMB: Math.round(MAX_RAW_TOTAL / 1024 / 1024),
        maxZipResponseMB: Math.round(MAX_ZIP_RESPONSE / 1024 / 1024)
      },
      ...extra
    },
    { status: 413, headers: { "X-GC-Error": "TOO_LARGE", "X-GC-Suggest": "github-actions" } }
  );
}

export function sumZipFilesBytes(zipFiles) {
  let total = 0;
  for (const data of Object.values(zipFiles || {})) {
    if (!data) continue;
    if (typeof data.byteLength === "number") total += data.byteLength;
    else if (typeof data.length === "number") total += data.length;
  }
  return total;
}
