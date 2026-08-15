import { detectGameEngine } from "./engine.js";
import { classifyApiSemantics } from "../classify/api-semantics.js";

export function analyzeGameContent(zipFiles, manifest, htmlText = "") {
  const result = {
    scannedFiles: 0,
    parsedJson: 0,
    paytables: [],
    symbols: [],
    features: [],
    bets: [],
    atlases: [],
    spine: [],
    audioMaps: [],
    apiSnapshots: [],
    hints: [],
    engine: null,
    summary: {}
  };

  // Poin 3 embedded
  try {
    result.engine = detectGameEngine(zipFiles, manifest, htmlText);
  } catch (e) {
    result.engine = { engine: "unknown", confidence: "none", error: String(e.message || e) };
  }

  const symbolSet = new Set();
  const featureSet = new Set();

  function tryParseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function walkObject(obj, path, visitor, depth = 0) {
    if (depth > 8 || obj == null) return;
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => walkObject(v, path + "[" + i + "]", visitor, depth + 1));
      return;
    }
    if (typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      visitor(k, v, path);
      if (v && typeof v === "object") walkObject(v, path ? path + "." + k : k, visitor, depth + 1);
    }
  }

  function looksLikePaytable(key, value) {
    const k = String(key).toLowerCase();
    if (/paytable|pay[_-]?table|payouts?|pays|win[_-]?table/i.test(k)) return true;
    if (Array.isArray(value) && value.length >= 3) {
      const sample = value.slice(0, 5);
      if (sample.every(x => typeof x === "number" || (x && typeof x === "object" && ("pay" in x || "payout" in x || "prize" in x)))) {
        return /pay|win|prize|award/i.test(k);
      }
    }
    return false;
  }

  function extractSymbolsFromValue(key, value) {
    const k = String(key).toLowerCase();
    if (!/symbol|symbols|symb|icons?|tiles?/i.test(k)) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.length < 64) symbolSet.add(item);
        else if (item && typeof item === "object") {
          const name = item.name || item.id || item.key || item.symbol || item.code;
          if (name != null) symbolSet.add(String(name));
        }
      }
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [sk, sv] of Object.entries(value)) {
        if (typeof sv === "string" || typeof sv === "number") symbolSet.add(String(sk));
        else if (sv && typeof sv === "object") {
          const name = sv.name || sv.id || sk;
          symbolSet.add(String(name));
        }
      }
    }
  }

  function extractFeatures(key, value) {
    const k = String(key).toLowerCase();
    if (/freespin|free[_-]?spin|bonus|scatter|wild|multiplier|cascade|tumble|feature|jackpot/i.test(k)) {
      featureSet.add(k);
      if (value && typeof value === "object") {
        result.features.push({
          key: k,
          pathHint: key,
          sample: Array.isArray(value) ? { type: "array", length: value.length } : { type: "object", keys: Object.keys(value).slice(0, 12) }
        });
      } else if (value != null && typeof value !== "object") {
        result.features.push({ key: k, value: value });
      }
    }
  }

  function extractBets(key, value) {
    const k = String(key).toLowerCase();
    if (!/bet|bets|stake|stakes|coin|denom|lines?|ways|level|betlevels?/i.test(k)) return;
    if (Array.isArray(value) && value.every(x => typeof x === "number")) {
      result.bets.push({ key: k, values: value.slice(0, 40) });
    } else if (typeof value === "number") {
      result.bets.push({ key: k, value });
    } else if (value && typeof value === "object") {
      result.bets.push({ key: k, keys: Object.keys(value).slice(0, 20) });
    }
  }

  // Scan semua file di ZIP
  for (const [path, data] of Object.entries(zipFiles)) {
    if (!data || typeof data === "string") continue;
    const lower = path.toLowerCase();
    const isJson = /\.json$/i.test(lower) || lower.includes("/config/") || lower.includes("server/api/");
    const isAtlas = /\.atlas$/i.test(lower);
    const isSkel = /\.(skel|spine)$/i.test(lower);
    const isJs = /\.(js|mjs)$/i.test(lower);
    if (!isJson && !isAtlas && !isSkel && !isJs) continue;
    if (data.byteLength > 2_000_000) continue; // skip file sangat besar

    let text = "";
    try {
      text = new TextDecoder().decode(data);
    } catch {
      continue;
    }
    result.scannedFiles++;

    // Spine / atlas file names
    if (isSkel) {
      result.spine.push({ path, size: data.byteLength });
      continue;
    }
    if (isAtlas) {
      result.atlases.push({ path, size: data.byteLength, format: "libgdx-atlas" });
      // Atlas text often lists texture names
      const pages = text.split("\n").filter(l => /\.(png|jpg|webp)/i.test(l)).slice(0, 20);
      if (pages.length) result.atlases[result.atlases.length - 1].textures = pages.map(l => l.trim());
      continue;
    }

    // JSON parse
    if (isJson || text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
      const json = tryParseJson(text);
      if (!json) continue;
      result.parsedJson++;

      // TexturePacker / spritesheet JSON
      if (json.frames && (json.meta || json.textures)) {
        result.atlases.push({
          path,
          format: "texturepacker",
          frameCount: Object.keys(json.frames).length,
          meta: json.meta || null
        });
      }
      if (Array.isArray(json.textures) || (json.meta && json.meta.app)) {
        result.atlases.push({ path, format: "spritesheet-json", size: data.byteLength });
      }

      // Audio sprite map (howler-style)
      if (json.sprite && typeof json.sprite === "object" && (json.urls || json.src)) {
        result.audioMaps.push({
          path,
          format: "audio-sprite",
          keys: Object.keys(json.sprite).slice(0, 50)
        });
      }

      // Walk for paytable / symbols / features / bets
      walkObject(json, "", (key, value) => {
        if (looksLikePaytable(key, value)) {
          result.paytables.push({
            file: path,
            key,
            kind: Array.isArray(value) ? "array" : typeof value,
            preview: Array.isArray(value)
              ? value.slice(0, 5)
              : (value && typeof value === "object" ? Object.keys(value).slice(0, 15) : value)
          });
        }
        extractSymbolsFromValue(key, value);
        extractFeatures(key, value);
        extractBets(key, value);
      });

      // API snapshot semantics (Poin 4)
      if (path.startsWith("server/api/") || path.includes("/api/") || path.includes("server/")) {
        const sem = classifyApiSemantics(path, "fetch", "application/json", text);
        result.apiSnapshots.push({
          path,
          kind: sem.kind,
          confidence: sem.confidence,
          fields: sem.fields,
          topKeys: sem.topKeys.slice(0, 20),
          signals: sem.signals,
          size: data.byteLength
        });
      }
    }

    // JS: light string scan for known keys (no full parse)
    if (isJs && text.length < 500_000) {
      const symMatches = text.match(/["'](?:symbol|symb|wild|scatter|bonus)[_-]?[a-z0-9]*["']/gi);
      if (symMatches) {
        for (const m of symMatches.slice(0, 30)) {
          symbolSet.add(m.replace(/["']/g, ""));
        }
      }
      if (/paytable|payTable|PAYTABLE/i.test(text)) {
        result.hints.push({ file: path, hint: "paytable-reference-in-js" });
      }
      if (/freeSpin|free_spin|FreeSpin|scatter|cascad|tumble/i.test(text)) {
        result.hints.push({ file: path, hint: "feature-reference-in-js" });
      }
    }
  }

  result.symbols = [...symbolSet].slice(0, 200);
  // dedupe features by key
  const featKeys = new Set();
  result.features = result.features.filter(f => {
    const k = f.key || "";
    if (featKeys.has(k)) return false;
    featKeys.add(k);
    return true;
  }).slice(0, 50);

  // Agregasi API kinds dari snapshot + manifest
  const apiKindCounts = {};
  for (const s of result.apiSnapshots) {
    const k = s.kind || "unknown";
    apiKindCounts[k] = (apiKindCounts[k] || 0) + 1;
  }
  for (const r of manifest || []) {
    if (r.apiKind) {
      apiKindCounts[r.apiKind] = (apiKindCounts[r.apiKind] || 0) + 1;
    }
  }

  result.summary = {
    engine: result.engine?.engine || "unknown",
    engineConfidence: result.engine?.confidence || "none",
    jsonParsed: result.parsedJson,
    paytableHits: result.paytables.length,
    symbolCount: result.symbols.length,
    featureHits: result.features.length,
    betConfigs: result.bets.length,
    atlasCount: result.atlases.length,
    spineCount: result.spine.length,
    audioMapCount: result.audioMaps.length,
    apiSnapshotCount: result.apiSnapshots.length,
    apiKinds: apiKindCounts,
    note: "Hasil heuristik dari isi file yang ter-collect. Bukan reverse-engineer server."
  };

  return result;
}
