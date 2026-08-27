/**
 * Klasifikasi sub-folder khusus slot / game asset (Poin 1).
 * Mengembalikan nama subfolder di bawah assets/ berdasarkan
 * path, nama file, ekstensi, dan tipe resource.
 */
export function classifySlotSubfolder(url, type, contentType = "") {
  const u = String(url || "").toLowerCase();
  let pathname = "";
  let filename = "";
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname.toLowerCase();
    filename = (pathname.split("/").pop() || "").split("?")[0];
  } catch {
    filename = u.split("/").pop() || "";
  }
  const ct = (contentType || "").toLowerCase();

  // --- Config / data definitions ---
  if (
    /paytable|pay[_-]?table|payout/i.test(u) ||
    /paytable|pay[_-]?table/.test(filename)
  ) {
    return { sub: "config/paytable", reason: "paytable" };
  }
  if (
    /\/(config|configs|settings|data)\//i.test(pathname) &&
    (/\.json($|\?)/i.test(pathname) || ct.includes("json"))
  ) {
    if (/symbol/i.test(u)) return { sub: "config/symbols", reason: "symbol-config" };
    if (/feature|bonus|freespin|free[_-]?spin|scatter|wild/i.test(u)) {
      return { sub: "config/features", reason: "feature-config" };
    }
    return { sub: "config", reason: "config-json" };
  }
  if (/\.(json|xml)($|\?)/i.test(pathname) && /symbol|reel|pay|feature|bet|line|ways/i.test(filename)) {
    if (/symbol/i.test(filename)) return { sub: "config/symbols", reason: "symbol-json" };
    if (/pay/i.test(filename)) return { sub: "config/paytable", reason: "pay-json" };
    if (/feature|bonus|free/i.test(filename)) return { sub: "config/features", reason: "feature-json" };
    return { sub: "config", reason: "game-data-json" };
  }

  // --- Atlas / Spine / skeletal ---
  if (/\.(atlas|skel|spine)($|\?)/i.test(pathname) || /spine|skeleton|skeletal/i.test(u)) {
    return { sub: "atlases", reason: "spine-atlas" };
  }
  if (/atlas|spritesheet|sprite[_-]?sheet|textureatlas|texture[_-]?atlas/i.test(u)) {
    return { sub: "atlases", reason: "spritesheet-atlas" };
  }

  // --- Symbols ---
  if (
    /\/symbols?\//i.test(pathname) ||
    /\b(symbol|symbols|symb)[_-]?\d*/i.test(filename) ||
    /\b(wild|scatter|bonus|jackpot|mystery)[_-]?(symbol|sym|icon)?/i.test(filename) ||
    /\b(high|low|mid)[_-]?(symbol|sym|icon)/i.test(filename)
  ) {
    return { sub: "symbols", reason: "symbol-path-or-name" };
  }

  // --- Reels ---
  if (
    /\/reels?\//i.test(pathname) ||
    /\b(reel|reels|strip|reelstrip|reel[_-]?strip)[_-]?\d*/i.test(filename) ||
    /\breel[_-]?(bg|background|frame|mask)/i.test(filename)
  ) {
    return { sub: "reels", reason: "reel-path-or-name" };
  }

  // --- Backgrounds ---
  if (
    /\/(bg|backgrounds?|backdrops?)\//i.test(pathname) ||
    /\b(bg|background|backdrop|scene[_-]?bg)[_-]?\w*/i.test(filename)
  ) {
    return { sub: "backgrounds", reason: "background" };
  }

  // --- UI ---
  if (
    /\/(ui|hud|interface|buttons?|controls?)\//i.test(pathname) ||
    /\b(btn|button|ui|hud|panel|popup|modal|spinner|loader|progress|meter|bar)[_-]?\w*/i.test(filename) ||
    /\b(spin[_-]?btn|auto[_-]?spin|max[_-]?bet|paytable[_-]?btn)/i.test(filename)
  ) {
    return { sub: "ui", reason: "ui-element" };
  }

  // --- Particles / effects ---
  if (
    /\/(particles?|effects?|fx|vfx)\//i.test(pathname) ||
    /\b(particle|emitter|spark|glow|flash|burst|fx|vfx)[_-]?\w*/i.test(filename)
  ) {
    return { sub: "particles", reason: "particle-fx" };
  }

  // --- Animations ---
  if (
    /\/(anims?|animations?|anim)\//i.test(pathname) ||
    /\b(anim|animation|win[_-]?anim|land(ing)?|transition|intro|outro)[_-]?\w*/i.test(filename) ||
    /\.(mp4|webm)($|\?)/i.test(pathname)
  ) {
    return { sub: "animations", reason: "animation" };
  }

  // --- Audio (lebih spesifik) ---
  if (type === "media" || /\.(mp3|ogg|wav|m4a|aac)($|\?)/i.test(pathname) || ct.startsWith("audio/")) {
    if (/\b(bgm|music|theme|ambient|loop)[_-]?\w*/i.test(filename)) {
      return { sub: "audio/bgm", reason: "bgm" };
    }
    if (/\b(spin|reel[_-]?stop|stop|click|ui[_-]?click|button)[_-]?\w*/i.test(filename)) {
      return { sub: "audio/sfx", reason: "sfx-ui-or-spin" };
    }
    if (/\b(win|big[_-]?win|mega|bonus|free[_-]?spin|scatter|feature)[_-]?\w*/i.test(filename)) {
      return { sub: "audio/win", reason: "win-or-feature" };
    }
    return { sub: "audio", reason: "audio-general" };
  }

  // --- Fonts ---
  if (type === "font" || /\.(woff2?|ttf|otf|eot)($|\?)/i.test(pathname) || ct.includes("font")) {
    return { sub: "fonts", reason: "font" };
  }

  // --- Scripts ---
  if (type === "script" || /\.(js|mjs)($|\?)/i.test(pathname)) {
    if (/engine|phaser|pixi|unity|main|bundle|app|game/i.test(filename)) {
      return { sub: "js/engine", reason: "engine-or-main" };
    }
    if (/reel|symbol|paytable|feature|bonus|spin|slot/i.test(filename)) {
      return { sub: "js/logic", reason: "game-logic" };
    }
    return { sub: "js", reason: "script" };
  }

  // --- Styles ---
  if (type === "stylesheet" || /\.css($|\?)/i.test(pathname)) {
    return { sub: "css", reason: "stylesheet" };
  }

  // --- HTML ---
  if (type === "document" || /\.html?($|\?)/i.test(pathname)) {
    return { sub: "html", reason: "document" };
  }

  // --- Images fallback ---
  if (type === "image" || /\.(png|jpe?g|gif|webp|svg|ico)($|\?)/i.test(pathname)) {
    return { sub: "images", reason: "image-general" };
  }

  // --- Data / XHR body yang dianggap game data ---
  if (type === "xhr" || type === "fetch") {
    return { sub: "data", reason: "data-xhr" };
  }

  return { sub: "other", reason: "unclassified" };
}

/**
 * Tentukan folder ZIP final.
 * category: game | api | server
 * sub: hasil classifySlotSubfolder (hanya dipakai untuk game)
 */
export function folderOf(type, category, sub = null) {
  // Offline-first enum: script | style | data
  if (category === "script") return "assets/js";
  if (category === "style") return "assets/css";
  if (category === "data") return "assets/data";

  if (category === "api" || category === "server") {
    return ({
      document: "server/html",
      script: "server/js",
      stylesheet: "server/css",
      image: "server/images",
      media: "server/media",
      font: "server/fonts",
      xhr: "server/api",
      fetch: "server/api"
    })[type] || "server/other";
  }

  // Game assets — pakai sub-folder slot jika ada
  if (sub && typeof sub === "string" && sub.length > 0) {
    return "assets/" + sub;
  }

  // Fallback lama (kompatibel)
  return ({
    document: "assets/html",
    script: "assets/js",
    stylesheet: "assets/css",
    image: "assets/images",
    media: "assets/audio",
    font: "assets/fonts",
    xhr: "assets/data",
    fetch: "assets/data"
  })[type] || "assets/other";
}
