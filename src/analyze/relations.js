/**
 * Mapping relasi asset: symbol ↔ atlas/anim ↔ audio
 * Heuristik nama + path (bukan runtime graph sempurna).
 */

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\.(png|jpe?g|gif|webp|svg|mp3|ogg|wav|json|atlas|skel)$/i, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function bare(path) {
  return String(path || "").split("/").pop() || "";
}

function scoreNameMatch(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 80;
  // token overlap
  const ta = new Set(na.split(/(?=[a-z][A-Z])|_|-/).join("").match(/[a-z]+/g) || [na]);
  // simpler: substring chunks
  let hit = 0;
  if (na.length >= 3 && nb.includes(na.slice(0, Math.min(6, na.length)))) hit += 40;
  if (nb.length >= 3 && na.includes(nb.slice(0, Math.min(6, nb.length)))) hit += 40;
  // common slot names
  const aliases = {
    wild: ["wild", "wld"],
    scatter: ["scatter", "scat", "bonus"],
    seven: ["seven", "7", "sev"],
    bell: ["bell"],
    cherry: ["cherry", "cher"],
    lemon: ["lemon"],
    orange: ["orange", "oran"],
    plum: ["plum"],
    grape: ["grape"],
    melon: ["melon", "wm"],
    star: ["star"],
    bar: ["bar"]
  };
  for (const [, list] of Object.entries(aliases)) {
    const aHit = list.some((x) => na.includes(x) || x.includes(na));
    const bHit = list.some((x) => nb.includes(x) || x.includes(nb));
    if (aHit && bHit) hit = Math.max(hit, 70);
  }
  return Math.min(100, hit);
}

/**
 * @param {object} analysis - hasil analyzeGameContent
 * @param {object} zipFiles
 * @param {object} deps - optional dependency analysis
 */
export function mapAssetRelations(analysis, zipFiles = {}, deps = null) {
  const symbols = (analysis && analysis.symbols) || [];
  const atlases = (analysis && analysis.atlases) || [];
  const spine = (analysis && analysis.spine) || [];
  const audioEvents = (analysis && analysis.audioEvents) || [];
  const features = (analysis && analysis.features) || [];
  const paths = Object.keys(zipFiles || {});

  const imagePaths = paths.filter((p) =>
    /\.(png|jpe?g|gif|webp|svg)$/i.test(p) || /\/(symbols?|reels?|icons?)\//i.test(p)
  );
  const animPaths = paths.filter((p) =>
    /\/(anim|animations?|spine|atlas)/i.test(p) || /\.(atlas|skel|json)$/i.test(p)
  );

  // Collect atlas region names
  const regions = [];
  for (const a of atlases) {
    const list = a.regions || a.regionDetails?.map((r) => r.name) || [];
    for (const name of list) {
      regions.push({ name: String(name), atlas: a.path, format: a.format });
    }
  }
  for (const s of spine) {
    for (const an of s.animations || []) {
      regions.push({ name: String(an), atlas: s.path, format: "spine-anim" });
    }
    for (const at of s.attachments || []) {
      regions.push({ name: String(at), atlas: s.path, format: "spine-attach" });
    }
  }

  const relations = [];
  const unmatchedSymbols = [];

  for (const sym of symbols.slice(0, 80)) {
    const row = {
      symbol: sym,
      images: [],
      regions: [],
      audio: [],
      score: 0
    };

    // images by name
    for (const img of imagePaths) {
      const sc = scoreNameMatch(sym, bare(img));
      if (sc >= 70) row.images.push({ path: img, score: sc });
    }
    row.images.sort((a, b) => b.score - a.score);
    row.images = row.images.slice(0, 5);

    // atlas / spine regions
    for (const r of regions) {
      const sc = scoreNameMatch(sym, r.name);
      if (sc >= 70) row.regions.push({ name: r.name, atlas: r.atlas, format: r.format, score: sc });
    }
    row.regions.sort((a, b) => b.score - a.score);
    row.regions = row.regions.slice(0, 5);

    // audio: wild/scatter/bonus often have themed SFX; also name match
    for (const a of audioEvents) {
      let sc = scoreNameMatch(sym, a.filename || a.path);
      const low = String(sym).toLowerCase();
      if (/wild/i.test(low) && /wild/i.test(a.filename || "")) sc = Math.max(sc, 85);
      if (/scatter|bonus/i.test(low) && /scatter|bonus|feature/i.test(a.filename || "")) sc = Math.max(sc, 80);
      if (sc >= 70) row.audio.push({ event: a.event, path: a.path, filename: a.filename, score: sc });
    }
    row.audio.sort((a, b) => b.score - a.score);
    row.audio = row.audio.slice(0, 5);

    row.score = Math.min(
      100,
      (row.images[0]?.score || 0) * 0.4 +
        (row.regions[0]?.score || 0) * 0.35 +
        (row.audio[0]?.score || 0) * 0.25
    );
    row.linked = row.images.length + row.regions.length + row.audio.length > 0;

    if (row.linked) relations.push(row);
    else unmatchedSymbols.push(sym);
  }

  // Feature → audio mapping
  const featureAudio = [];
  const featureAudioMap = {
    FreeSpin: ["Bonus", "Win", "UI"],
    Bonus: ["Bonus", "Win"],
    Cascade: ["Spin", "ReelStop"],
    Wild: ["Win", "UI"],
    Scatter: ["Bonus", "Win"],
    Multiplier: ["Win"],
    Jackpot: ["Win", "Bonus"],
    Respin: ["Spin", "ReelStop"],
    Gamble: ["UI", "Win"],
    BuyFeature: ["UI", "Bonus"]
  };
  const seenFeat = new Set();
  for (const f of features) {
    const t = f.type || "Other";
    if (seenFeat.has(t) || t === "Other" || t === "Feature") continue;
    seenFeat.add(t);
    const want = featureAudioMap[t] || [];
    const matches = audioEvents.filter((a) => want.includes(a.event)).slice(0, 8);
    featureAudio.push({
      feature: t,
      audioEvents: want,
      matched: matches.map((a) => ({ event: a.event, filename: a.filename, path: a.path }))
    });
  }

  // Global audio ↔ category (already in audioEvents; summarize coverage)
  const audioCoverage = {};
  for (const a of audioEvents) {
    audioCoverage[a.event] = (audioCoverage[a.event] || 0) + 1;
  }

  const linked = relations.filter((r) => r.linked).length;
  const total = symbols.length || 1;
  const score = symbols.length ? Math.round((linked / Math.min(symbols.length, 80)) * 100) : 0;

  return {
    symbolRelations: relations.slice(0, 60),
    unmatchedSymbols: unmatchedSymbols.slice(0, 40),
    featureAudio: featureAudio,
    audioCoverage,
    stats: {
      symbols: symbols.length,
      linked,
      unmatched: unmatchedSymbols.length,
      regions: regions.length,
      images: imagePaths.length,
      audio: audioEvents.length,
      score
    },
    note: "Relasi heuristik berbasis nama/path. Bukan binding runtime engine."
  };
}
