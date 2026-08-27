/**
 * Selective collect filter — hanya masukkan kategori yang diminta user.
 *
 * Kategori high-level (sesuai struktur GAME):
 *   launcher | frontend | assets | audio | engine | config | server | api
 *
 * Bisa juga pakai subfolder langsung:
 *   symbols | backgrounds | ui | particles | animations | atlases
 *   audio/bgm | audio/sfx | audio/win | html | css | js | js/engine | js/logic
 *   config/paytable | config/symbols | config/features | images | fonts | other
 */

/** High-level category → daftar subfolder (hasil classifySlotSubfolder / folderOf) */
export const CATEGORY_MAP = {
  launcher: ["html"],
  frontend: ["html", "css", "js", "js/engine", "js/logic"],
  assets: [
    "symbols", "backgrounds", "ui", "particles", "animations",
    "atlases", "images", "fonts", "other"
  ],
  audio: ["audio", "audio/bgm", "audio/sfx", "audio/win"],
  engine: ["js/engine", "js/logic", "js"],
  config: ["config", "config/paytable", "config/symbols", "config/features", "data"],
  server: ["server"],
  api: ["api"]
};

/** Semua subfolder yang dikenal (untuk validasi) */
export const ALL_SUBS = new Set([
  "html", "css", "js", "js/engine", "js/logic",
  "symbols", "backgrounds", "ui", "particles", "animations", "atlases",
  "images", "fonts", "other", "data",
  "audio", "audio/bgm", "audio/sfx", "audio/win",
  "config", "config/paytable", "config/symbols", "config/features",
  "server", "api"
]);

/**
 * Parse body.include / body.exclude → Set subfolder yang diizinkan.
 * Jika include kosong → izinkan semua (backward compatible).
 *
 * @param {string[]|string|undefined} include
 * @param {string[]|string|undefined} exclude
 * @returns {{ allowed: Set<string>|null, rawInclude: string[], rawExclude: string[] }}
 *   allowed = null berarti "semua diizinkan"
 */
export function buildAllowedSet(include, exclude) {
  const toArr = (v) => {
    if (Array.isArray(v)) return v.map(String).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (typeof v === "string" && v.trim()) {
      return v.split(/[,|\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
    return [];
  };

  const rawInclude = toArr(include);
  const rawExclude = toArr(exclude);

  const expand = (list) => {
    const out = new Set();
    for (const key of list) {
      if (CATEGORY_MAP[key]) {
        for (const sub of CATEGORY_MAP[key]) out.add(sub);
      } else if (ALL_SUBS.has(key) || key.startsWith("audio/") || key.startsWith("config/") || key.startsWith("js/")) {
        out.add(key);
      } else {
        out.add(key);
      }
    }
    return out;
  };

  if (rawInclude.length === 0 && rawExclude.length === 0) {
    return { allowed: null, rawInclude, rawExclude };
  }

  let allowed;
  if (rawInclude.length > 0) {
    allowed = expand(rawInclude);
  } else {
    allowed = new Set(ALL_SUBS);
  }

  if (rawExclude.length > 0) {
    const ex = expand(rawExclude);
    for (const s of ex) allowed.delete(s);
  }

  return { allowed, rawInclude, rawExclude };
}

/**
 * Cek apakah resource ini boleh masuk ZIP.
 *
 * @param {object} opts
 * @param {string} opts.category   - "game" | "api" | "server"
 * @param {string|null} opts.sub   - hasil classifySlotSubfolder
 * @param {string} opts.folder     - hasil folderOf
 * @param {Set<string>|null} opts.allowed
 * @returns {boolean}
 */
export function shouldIncludeResource({ category, sub, folder, allowed }) {
  if (!allowed) return true;

  if (category === "server") {
    return allowed.has("server");
  }
  if (category === "api") {
    return allowed.has("api") || allowed.has("server");
  }
  // script/style/data = asset frontend
  if (category === "script" || category === "style" || category === "data") {
    if (allowed.has("frontend") || allowed.has("engine") || allowed.has(category)) return true;
    if (category === "script" && (allowed.has("js") || allowed.has("assets/js"))) return true;
    if (category === "style" && (allowed.has("css") || allowed.has("assets/css"))) return true;
    if (category === "data" && (allowed.has("config") || allowed.has("assets/data"))) return true;
  }

  const subKey = (sub || "").toLowerCase();
  if (subKey && allowed.has(subKey)) return true;

  const f = String(folder || "").toLowerCase();
  if (f.startsWith("assets/")) {
    const rest = f.slice("assets/".length);
    if (allowed.has(rest)) return true;
    const parent = rest.split("/")[0];
    if (parent && allowed.has(parent)) return true;
  }
  if (f.startsWith("server/")) {
    return allowed.has("server");
  }

  return false;
}
