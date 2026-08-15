/**
 * Batas aman Worker tanpa R2.
 * Memory Worker ~128MB → ZIP di memory harus jauh di bawah itu.
 * GitHub Actions dipakai untuk paket yang lebih besar.
 */

/** Max ukuran 1 file resource (bytes) */
export const MAX_SINGLE_FILE = 18 * 1024 * 1024; // 18 MB

/** Max total raw buffer sebelum zip (bytes) */
export const MAX_RAW_TOTAL = 38 * 1024 * 1024; // 38 MB

/** Max ukuran ZIP response (bytes) */
export const MAX_ZIP_RESPONSE = 22 * 1024 * 1024; // 22 MB

export function tooLargeResponse(extra = {}) {
  return Response.json(
    {
      ok: false,
      error: "TOO_LARGE",
      code: "TOO_LARGE",
      message:
        "Paket terlalu besar untuk dikirim lewat Worker (batas aman tanpa R2 ~20–25 MB ZIP). " +
        "Gunakan tombol Collect via GitHub Actions untuk game besar.",
      suggest: "github-actions",
      limits: {
        maxSingleFileMB: Math.round(MAX_SINGLE_FILE / 1024 / 1024),
        maxRawTotalMB: Math.round(MAX_RAW_TOTAL / 1024 / 1024),
        maxZipResponseMB: Math.round(MAX_ZIP_RESPONSE / 1024 / 1024)
      },
      ...extra
    },
    {
      status: 413,
      headers: {
        "X-GC-Error": "TOO_LARGE",
        "X-GC-Suggest": "github-actions"
      }
    }
  );
}

/** Hitung total byte object zipFiles (Uint8Array / string encoded) */
export function sumZipFilesBytes(zipFiles) {
  let total = 0;
  for (const data of Object.values(zipFiles || {})) {
    if (!data) continue;
    if (typeof data.byteLength === "number") total += data.byteLength;
    else if (typeof data.length === "number") total += data.length;
  }
  return total;
}
