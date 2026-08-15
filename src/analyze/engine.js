/**
 * Poin 3 — Deteksi game engine dari URL, nama file, dan cuplikan isi.
 * Mengembalikan engine utama + skor + bukti.
 */
export function detectGameEngine(zipFiles, manifest, htmlText = "") {
  const scores = {
    phaser: 0,
    pixi: 0,
    unity: 0,
    construct: 0,
    cocos: 0,
    playcanvas: 0,
    babylon: 0,
    three: 0,
    godot: 0,
    melonjs: 0,
    kaboom: 0,
    custom_slot: 0,
    unknown: 0
  };
  const evidence = [];

  function add(engine, points, why) {
    scores[engine] = (scores[engine] || 0) + points;
    evidence.push({ engine, points, why });
  }

  const allTextBits = [];
  if (htmlText) allTextBits.push(htmlText.slice(0, 80_000));

  // Manifest URLs + paths
  for (const r of manifest || []) {
    const u = (r.url || "") + " " + (r.localPath || "");
    const low = u.toLowerCase();

    if (/phaser/i.test(low)) add("phaser", 8, "url/path: " + (r.localPath || r.url || "").slice(0, 80));
    if (/pixi\.?js|pixi-/i.test(low)) add("pixi", 8, "url/path pixi");
    if (/unity|unityloader|\.unityweb|build\/.*\.framework/i.test(low)) add("unity", 10, "url/path unity");
    if (/\.data($|\?)|\.wasm($|\?)|\.framework\.js|streamingassets/i.test(low)) add("unity", 6, "unity-like binary: " + low.slice(0, 60));
    if (/construct|c3runtime|c2runtime/i.test(low)) add("construct", 10, "url/path construct");
    if (/cocos2d|cocoscreator|cocos-/i.test(low)) add("cocos", 8, "url/path cocos");
    if (/playcanvas/i.test(low)) add("playcanvas", 8, "url/path playcanvas");
    if (/babylon\.?js|babylonjs/i.test(low)) add("babylon", 8, "url/path babylon");
    if (/three\.?js|three\.min/i.test(low)) add("three", 6, "url/path three");
    if (/godot|\.pck($|\?)/i.test(low)) add("godot", 8, "url/path godot");
    if (/melonjs|melon\.js/i.test(low)) add("melonjs", 6, "url/path melonjs");
    if (/kaboom/i.test(low)) add("kaboom", 6, "url/path kaboom");

    // Slot-ish client hints
    if (/slot|reel|paytable|freespin|scatter/i.test(low)) add("custom_slot", 2, "slot keyword in path");
  }

  // Scan file contents (limited)
  for (const [path, data] of Object.entries(zipFiles || {})) {
    if (!data || data.byteLength > 1_500_000) continue;
    const lowPath = path.toLowerCase();
    if (!/\.(js|mjs|html?|json|wasm)$/i.test(lowPath) && path !== "index.html") continue;

    let text = "";
    try {
      if (/\.wasm$/i.test(lowPath)) {
        add("unity", 4, "wasm file: " + path);
        continue;
      }
      text = new TextDecoder().decode(data.slice(0, 120_000));
    } catch {
      continue;
    }
    allTextBits.push(text);

    if (/Phaser\.Game|new Phaser\.|Phaser\.Scene|phaser\.min\.js/i.test(text)) {
      add("phaser", 15, "content signature Phaser in " + path);
    }
    if (/PIXI\.Application|PIXI\.Container|pixi\.js|PIXI\.Sprite/i.test(text)) {
      add("pixi", 15, "content signature PIXI in " + path);
    }
    if (/UnityLoader|unityFramework|createUnityInstance|Module\.\[\"canvas\"\]/i.test(text)) {
      add("unity", 15, "content signature Unity in " + path);
    }
    if (/runOnStartup|cr\.runtime|C3\.SystemInfo|c3_runtimeInterface/i.test(text)) {
      add("construct", 15, "content signature Construct in " + path);
    }
    if (/cc\.game|cc\.director|CocosEngine|cc\.Sprite/i.test(text)) {
      add("cocos", 12, "content signature Cocos in " + path);
    }
    if (/pc\.Application|playcanvas/i.test(text)) {
      add("playcanvas", 12, "content signature PlayCanvas in " + path);
    }
    if (/BABYLON\.Engine|BABYLON\.Scene/i.test(text)) {
      add("babylon", 12, "content signature Babylon in " + path);
    }
    if (/THREE\.Scene|THREE\.WebGLRenderer/i.test(text)) {
      add("three", 10, "content signature Three.js in " + path);
    }
    if (/GodotEngine|Engine\.js|godot/i.test(text) && /wasm/i.test(text + lowPath)) {
      add("godot", 12, "content signature Godot in " + path);
    }

    // Generic HTML5 slot patterns (no known engine lib)
    if (/reelStrip|reel_strip|spinReels|startSpin|payLines|paylines|scatterCount/i.test(text)) {
      add("custom_slot", 5, "slot logic identifiers in " + path);
    }
  }

  // Combined HTML/JS bag for extra signals
  const bag = allTextBits.join("\n").slice(0, 200_000);
  if (/<canvas/i.test(bag) && /webgl/i.test(bag)) {
    // weak signal only
  }

  // Pick winner
  let best = "unknown";
  let bestScore = 0;
  for (const [eng, sc] of Object.entries(scores)) {
    if (eng === "unknown") continue;
    if (sc > bestScore) {
      bestScore = sc;
      best = eng;
    }
  }
  if (bestScore < 5) best = "unknown";

  const ranked = Object.entries(scores)
    .filter(([, sc]) => sc > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([engine, score]) => ({ engine, score }));

  // Repair hints per engine (for later Poin / Auto Repair)
  const repairHints = {
    phaser: ["Check Phaser asset pack / load.atlas paths", "Prefer relative paths under assets/"],
    pixi: ["Check PIXI.Loader / Assets.load paths", "Atlas JSON + image pairs"],
    unity: ["Needs Unity loader + .data/.wasm/.framework together", "StreamingAssets paths", "Offline often needs custom loader patch"],
    construct: ["c3runtime + data.js + images", "Preview may need specific MIME"],
    cocos: ["settings.js / main.js / cocos2d-js order", "asset-db style paths"],
    playcanvas: ["config.json + asset registry"],
    custom_slot: ["Verify reel/symbol image paths", "Paytable JSON paths", "Hybrid mode recommended if API required"],
    unknown: ["Use Online Hybrid preview", "Inspect manifest + analisis.json"]
  };

  return {
    engine: best,
    confidence: bestScore >= 15 ? "high" : bestScore >= 8 ? "medium" : bestScore >= 5 ? "low" : "none",
    score: bestScore,
    ranked,
    evidence: evidence.slice(0, 40),
    repairHints: repairHints[best] || repairHints.unknown
  };
}
