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
    audioEvents: [],
    apiSnapshots: [],
    hints: [],
    engine: null,
    scores: null,
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


  function classifyAudioEvent(path, filename) {
    const f = String(filename || path || "").toLowerCase();
    const p = String(path || "").toLowerCase();
    const s = f + " " + p;
    if (/\b(bgm|music|theme|ambient|loop[_-]?bgm|soundtrack)\b/.test(s)) return "BGM";
    if (/\b(reel[_-]?stop|stop[_-]?reel|land|thunk|clack)\b/.test(s)) return "ReelStop";
    if (/\b(spin|reel[_-]?spin|start[_-]?spin|roll)\b/.test(s)) return "Spin";
    if (/\b(big[_-]?win|mega[_-]?win|super[_-]?win|total[_-]?win|you[_-]?win)\b/.test(s)) return "Win";
    if (/\b(win|payout|prize|coin|credit)\b/.test(s)) return "Win";
    if (/\b(bonus|feature|free[_-]?spin|freespin|scatter|jackpot|trigger)\b/.test(s)) return "Bonus";
    if (/\b(click|button|ui|menu|hover|select|nav|tick|beep)\b/.test(s)) return "UI";
    if (/audio\/(bgm|music)/.test(p)) return "BGM";
    if (/audio\/(win|bonus)/.test(p)) return "Win";
    if (/audio\/(sfx|ui)/.test(p)) return "UI";
    return "Other";
  }

  function parseLibgdxAtlas(text, path) {
    const lines = String(text || "").split(/\r?\n/);
    const regions = [];
    let page = null;
    let current = null;
    for (const raw of lines) {
      const line = raw.replace(/\t/g, "  ");
      if (!line.trim()) continue;
      if (!line.startsWith(" ") && !line.startsWith("\t")) {
        // page texture or region name
        if (/\.png|\.jpg|\.webp|\.ktx/i.test(line.trim())) {
          page = line.trim();
          current = null;
        } else {
          current = { name: line.trim(), page };
          regions.push(current);
        }
      } else if (current) {
        const m = line.trim().match(/^(\w+):\s*(.+)$/);
        if (m) {
          const k = m[1].toLowerCase();
          const v = m[2].trim();
          if (k === "xy" || k === "size" || k === "orig" || k === "offset") current[k] = v;
          else if (k === "rotate") current.rotate = v;
          else if (k === "index") current.index = v;
        }
      }
    }
    return {
      path,
      format: "libgdx-atlas",
      pageCount: new Set(regions.map(r => r.page).filter(Boolean)).size || (page ? 1 : 0),
      regionCount: regions.length,
      regions: regions.slice(0, 80).map(r => r.name),
      regionDetails: regions.slice(0, 20)
    };
  }

  function parseSpineSkeletonHints(text, path) {
    // JSON spine skeleton or text hints
    const out = { path, animations: [], skins: [], attachments: [], bones: 0 };
    try {
      const j = JSON.parse(text);
      if (j.animations && typeof j.animations === "object") {
        out.animations = Object.keys(j.animations).slice(0, 40);
      }
      if (j.skins) {
        if (Array.isArray(j.skins)) {
          out.skins = j.skins.map(s => s.name || s).filter(Boolean).slice(0, 20);
          for (const skin of j.skins.slice(0, 5)) {
            const atts = skin.attachments || {};
            for (const slot of Object.keys(atts)) {
              for (const an of Object.keys(atts[slot] || {})) out.attachments.push(an);
            }
          }
        } else if (typeof j.skins === "object") {
          out.skins = Object.keys(j.skins).slice(0, 20);
        }
      }
      if (j.bones && Array.isArray(j.bones)) out.bones = j.bones.length;
      if (j.slots && Array.isArray(j.slots)) out.slotCount = j.slots.length;
    } catch {
      // binary skel — only size known
    }
    out.attachments = [...new Set(out.attachments)].slice(0, 40);
    return out;
  }

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

        // Spine / atlas file names (deep)
    if (isSkel) {
      const spineInfo = { path, size: data.byteLength };
      if (text && (text.trim().startsWith("{") || path.toLowerCase().endsWith(".json"))) {
        Object.assign(spineInfo, parseSpineSkeletonHints(text, path));
      } else {
        spineInfo.format = "binary-or-unknown";
      }
      result.spine.push(spineInfo);
    }
    if (isAtlas) {
      const atlasInfo = parseLibgdxAtlas(text, path);
      atlasInfo.size = data.byteLength;
      result.atlases.push(atlasInfo);
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


  // Map standalone audio files to events (BGM/Spin/ReelStop/Win/Bonus/UI)
  const audioEventSet = new Map();
  for (const [path, data] of Object.entries(zipFiles || {})) {
    if (!/\.(mp3|ogg|wav|m4a|aac|flac)($|\?)/i.test(path) && !path.toLowerCase().includes("/audio/")) continue;
    if (!/\.(mp3|ogg|wav|m4a|aac|flac)$/i.test(path.split("?")[0])) continue;
    const filename = path.split("/").pop();
    const ev = classifyAudioEvent(path, filename);
    const key = ev + "::" + filename;
    if (!audioEventSet.has(key)) {
      audioEventSet.set(key, {
        event: ev,
        path,
        filename,
        size: data?.byteLength || 0
      });
    }
  }
  result.audioEvents = [...audioEventSet.values()].slice(0, 120);
  const audioByEvent = {};
  for (const a of result.audioEvents) {
    audioByEvent[a.event] = (audioByEvent[a.event] || 0) + 1;
  }

  // Completeness scores (heuristic 0-100 per category)
  function scoreCat(found, good, excellent) {
    if (found <= 0) return 0;
    if (found >= excellent) return 100;
    if (found >= good) return 60 + Math.round(40 * (found - good) / Math.max(1, excellent - good));
    return Math.round(60 * found / good);
  }
  const symN = result.symbols.length;
  const payN = result.paytables.length;
  const featN = result.features.length;
  const atlasN = result.atlases.length + result.spine.length;
  const audioN = result.audioEvents.length;
  const audioMapped = result.audioEvents.filter(a => a.event !== "Other").length;
  const engineOk = result.engine && result.engine.engine && result.engine.engine !== "unknown";

  result.scores = {
    symbols: { score: scoreCat(symN, 5, 15), found: symN, label: "Symbols", ok: symN >= 3 },
    paytable: { score: payN > 0 ? 100 : (result.hints.some(h => h.hint === "paytable-reference-in-js") ? 40 : 0), found: payN, label: "Paytable", ok: payN > 0 },
    audio: {
      score: audioN === 0 ? 0 : Math.min(100, Math.round(40 + 60 * (audioMapped / Math.max(audioN, 1)))),
      found: audioN,
      mapped: audioMapped,
      byEvent: audioByEvent,
      label: "Audio events",
      ok: audioMapped >= 2
    },
    atlasSpine: {
      score: scoreCat(atlasN, 1, 3),
      found: atlasN,
      atlas: result.atlases.length,
      spine: result.spine.length,
      label: "Atlas / Spine",
      ok: atlasN > 0
    },
    features: { score: scoreCat(featN, 1, 4), found: featN, label: "Game features", ok: featN > 0 },
    engine: {
      score: engineOk ? (result.engine.confidence === "high" ? 100 : result.engine.confidence === "medium" ? 70 : 40) : 0,
      found: engineOk ? 1 : 0,
      name: result.engine?.engine || "unknown",
      confidence: result.engine?.confidence || "none",
      label: "Engine",
      ok: engineOk
    }
  };
  const scoreVals = Object.values(result.scores).map(s => s.score);
  result.scores.overall = Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length);

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
    audioEventCount: result.audioEvents.length,
    audioByEvent: audioByEvent,
    apiSnapshotCount: result.apiSnapshots.length,
    apiKinds: apiKindCounts,
    scores: result.scores,
    note: "Hasil heuristik dari isi file yang ter-collect. Bukan reverse-engineer server."
  };

  return result;
}
