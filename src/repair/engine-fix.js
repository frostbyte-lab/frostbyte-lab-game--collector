/**
 * Engine-specific offline repair patches (text transforms).
 * Applied on HTML/JS after generic path rewrite.
 */

export function detectEngineFromAnalysis(analysis, zipFS) {
  if (analysis?.engine?.engine && analysis.engine.engine !== "unknown") {
    return analysis.engine;
  }
  if (analysis?.summary?.engine && analysis.summary.engine !== "unknown") {
    return { engine: analysis.summary.engine, confidence: analysis.summary.engineConfidence || "low" };
  }
  // light fallback from paths
  const keys = Object.keys(zipFS || {}).join(" ").toLowerCase();
  if (/phaser/.test(keys)) return { engine: "phaser", confidence: "low" };
  if (/pixi/.test(keys)) return { engine: "pixi", confidence: "low" };
  if (/unity|unityloader|\.unityweb|\.framework\.js/.test(keys)) return { engine: "unity", confidence: "medium" };
  if (/c3runtime|c2runtime|construct/.test(keys)) return { engine: "construct", confidence: "medium" };
  if (/cocos/.test(keys)) return { engine: "cocos", confidence: "low" };
  return { engine: "unknown", confidence: "none" };
}

/**
 * Returns { text, fixes: string[] }
 */
export function applyEngineRepairs(text, engine, filePath = "") {
  const fixes = [];
  let out = text;
  const eng = (engine || "unknown").toLowerCase();
  const isHtml = /\.html?$/i.test(filePath) || filePath === "index.html";
  const isJs = /\.(js|mjs)$/i.test(filePath);

  if (eng === "phaser" && (isJs || isHtml)) {
    // Soften absolute CDN phaser paths already rewritten; ensure baseURL relative
    if (/Phaser\.Game|new Phaser/i.test(out)) {
      if (!out.includes("__gc_phaser_base")) {
        const patch = isHtml
          ? `<script>window.__gc_phaser_base=1;try{if(typeof Phaser!=='undefined'&&Phaser.Game){/*gc*/}}catch(e){}</script>`
          : "";
        if (isHtml && out.includes("</head>") && patch) {
          out = out.replace("</head>", patch + "</head>");
          fixes.push("phaser-base-flag");
        }
      }
    }
    // Common: load path absolute → relative hint in comments already handled by path rewrite
    if (/this\.load\.setBaseURL\(\s*['"]https?:/i.test(out)) {
      out = out.replace(/this\.load\.setBaseURL\(\s*['"]https?:\/\/[^'"]+['"]\s*\)/gi, 'this.load.setBaseURL("./")');
      fixes.push("phaser-setBaseURL-relative");
    }
    if (/this\.load\.setPath\(\s*['"]https?:/i.test(out)) {
      out = out.replace(/this\.load\.setPath\(\s*['"]https?:\/\/[^'"]+['"]\s*\)/gi, 'this.load.setPath("./")');
      fixes.push("phaser-setPath-relative");
    }
  }

  if (eng === "pixi" && (isJs || isHtml)) {
    if (/PIXI\.Assets\.setBasePath\(\s*['"]https?:/i.test(out)) {
      out = out.replace(/PIXI\.Assets\.setBasePath\(\s*['"]https?:\/\/[^'"]+['"]\s*\)/gi, 'PIXI.Assets.setBasePath("./")');
      fixes.push("pixi-setBasePath-relative");
    }
    if (/baseUrl\s*:\s*['"]https?:/i.test(out)) {
      out = out.replace(/baseUrl\s*:\s*['"]https?:\/\/[^'"]+['"]/gi, 'baseUrl: "./"');
      fixes.push("pixi-baseUrl-relative");
    }
  }

  if (eng === "unity" && (isJs || isHtml)) {
    // Prevent absolute streaming URL
    if (/streamingAssetsUrl\s*=\s*['"]https?:/i.test(out)) {
      out = out.replace(/streamingAssetsUrl\s*=\s*['"]https?:\/\/[^'"]+['"]/gi, 'streamingAssetsUrl = "StreamingAssets"');
      fixes.push("unity-streamingAssets-relative");
    }
    if (/companyName\s*:\s*["'][^"']+["']/.test(out) && isHtml) {
      // ensure canvas create - skip
    }
    // dataUrl / frameworkUrl absolute
    out = out.replace(/(dataUrl|frameworkUrl|codeUrl|companyNameUrl)\s*:\s*["']https?:\/\/[^"']+["']/gi, (m, k) => {
      fixes.push("unity-" + k + "-strip-host");
      return m.replace(/https?:\/\/[^/]+/i, ".");
    });
  }

  if (eng === "construct" && (isJs || isHtml)) {
    // runtime often needs relative path for data.json
    if (/["']https?:\/\/[^"']+\/data\.json["']/i.test(out)) {
      out = out.replace(/["']https?:\/\/[^"']+\/(data\.json)["']/gi, '"./data.json"');
      fixes.push("construct-data-json-relative");
    }
  }

  if (eng === "cocos" && (isJs || isHtml)) {
    if (/RELEVANT_ENGINE|cocos2d/i.test(out) && /server\s*:\s*['"]https?:/i.test(out)) {
      out = out.replace(/server\s*:\s*['"]https?:\/\/[^'"]+['"]/gi, 'server: "./"');
      fixes.push("cocos-server-relative");
    }
  }

  if (eng === "custom_slot" || eng === "unknown") {
    // Soft: ensure base href relative already done generically
  }

  // Universal engine-agnostic extras useful for slots
  if (isHtml && !/__gc_engine_repair/.test(out)) {
    const meta = `<script>window.__gc_engine_repair=${JSON.stringify(eng)};</script>`;
    if (out.includes("</head>")) {
      out = out.replace("</head>", meta + "</head>");
      fixes.push("engine-meta-flag");
    }
  }

  return { text: out, fixes };
}

export function engineBootstrapSnippet(engine) {
  const eng = (engine || "unknown").toLowerCase();
  const lines = [
    "window.__gc_engine=" + JSON.stringify(eng) + ";",
    "try{ if(typeof Phaser!=='undefined' && Phaser.Game && !window.__gc_phaser_patch){ window.__gc_phaser_patch=1; } }catch(e){}",
  ];
  if (eng === "unity") {
    lines.push("try{ if(typeof createUnityInstance==='function'){ console.info('[GC] Unity loader present'); } }catch(e){}");
  }
  if (eng === "pixi") {
    lines.push("try{ if(window.PIXI && PIXI.Assets && !window.__gc_pixi_base){ window.__gc_pixi_base=1; } }catch(e){}");
  }
  return lines.join("");
}
