export function buildKeterangan(target, manifest, smart, analysis = null) {
  const game = manifest.filter(r => r.category === "game");
  const api = manifest.filter(r => r.category === "api");
  const server = manifest.filter(r => r.category === "server");

  // Hitung sub-kategori slot (Poin 1)
  const subCounts = {};
  for (const r of game) {
    const sub = r.subCategory || "other";
    subCounts[sub] = (subCounts[sub] || 0) + 1;
  }
  const subSorted = Object.entries(subCounts).sort((a, b) => b[1] - a[1]);

  const hosts = new Map();
  for (const r of manifest) {
    try {
      const h = new URL(r.url).hostname;
      if (!hosts.has(h)) hosts.set(h, { count: 0, categories: new Set(), samples: [] });
      const info = hosts.get(h);
      info.count++;
      info.categories.add(r.category || "game");
      if (info.samples.length < 5) info.samples.push(r.url);
    } catch {}
  }

  const apiEndpoints = api.slice(0, 80).map(r => ({
    url: r.url,
    method_hint: r.type,
    status: r.status,
    localPath: r.localPath,
    size: r.size,
    reason: r.classifyReason || ""
  }));

  const lines = [];
  lines.push("# KETERANGAN PAKET — Game Collector Pro");
  lines.push("");
  lines.push(`**Target:** ${target}`);
  lines.push(`**Dikumpulkan:** ${new Date().toISOString()}`);
  lines.push(`**Total resource:** ${manifest.length}`);
  lines.push(`**Smart rewrite:** ${smart?.rewritten || 0} file · frame-buster: ${smart?.neutralized || 0}`);
  lines.push("");
  lines.push("## Pemisahan otomatis");
  lines.push("");
  lines.push("| Kategori | Jumlah | Folder di ZIP |");
  lines.push("|----------|--------|---------------|");
  lines.push(`| Game (asset client) | ${game.length} | \`assets/\` |`);
  lines.push(`| API (response XHR/fetch) | ${api.length} | \`server/api/\` |`);
  lines.push(`| Server / config | ${server.length} | \`server/\` |`);
  lines.push("");
  lines.push("## Sub-klasifikasi asset slot (Poin 1)");
  lines.push("");
  if (subSorted.length) {
    lines.push("| Sub-folder | Jumlah |");
    lines.push("|------------|--------|");
    for (const [sub, n] of subSorted) {
      lines.push(`| \`assets/${sub}/\` | ${n} |`);
    }
  } else {
    lines.push("_Tidak ada sub-klasifikasi (belum ada asset game)._");
  }
  lines.push("");

  // Poin 3 — engine
  lines.push("## Deteksi engine (Poin 3)");
  lines.push("");
  if (analysis && analysis.engine && !analysis.engine.error) {
    const eng = analysis.engine;
    lines.push(`- **Engine:** \`${eng.engine}\``);
    lines.push(`- **Confidence:** ${eng.confidence} (score ${eng.score ?? 0})`);
    if (eng.ranked && eng.ranked.length) {
      lines.push("- **Ranking:** " + eng.ranked.slice(0, 5).map(r => `${r.engine}(${r.score})`).join(", "));
    }
    if (eng.repairHints && eng.repairHints.length) {
      lines.push("- **Repair hints:**");
      for (const h of eng.repairHints) lines.push(`  - ${h}`);
    }
    if (eng.evidence && eng.evidence.length) {
      lines.push("- **Evidence (sample):**");
      for (const e of eng.evidence.slice(0, 8)) {
        lines.push(`  - [${e.engine} +${e.points}] ${e.why}`);
      }
    }
  } else {
    lines.push("_Engine tidak terdeteksi / analisis gagal._");
  }
  lines.push("");

  // Poin 2 — ringkasan analisis isi file
  lines.push("## Analisis isi file (Poin 2)");
  lines.push("");
  if (analysis && analysis.summary && !analysis.error) {
    const s = analysis.summary;
    lines.push("| Temuan | Jumlah |");
    lines.push("|--------|--------|");
    lines.push(`| Engine | ${s.engine ?? "unknown"} (${s.engineConfidence ?? "none"}) |`);
    lines.push(`| JSON ter-parse | ${s.jsonParsed ?? 0} |`);
    lines.push(`| Paytable hits | ${s.paytableHits ?? 0} |`);
    lines.push(`| Symbol terdeteksi | ${s.symbolCount ?? 0} |`);
    lines.push(`| Feature hits | ${s.featureHits ?? 0} |`);
    lines.push(`| Bet / lines config | ${s.betConfigs ?? 0} |`);
    lines.push(`| Atlas / spritesheet | ${s.atlasCount ?? 0} |`);
    lines.push(`| Spine / skel | ${s.spineCount ?? 0} |`);
    lines.push(`| Audio sprite map | ${s.audioMapCount ?? 0} |`);
    lines.push(`| API snapshot | ${s.apiSnapshotCount ?? 0} |`);
    lines.push("");
    if (analysis.symbols && analysis.symbols.length) {
      lines.push("**Contoh symbol:** " + analysis.symbols.slice(0, 30).join(", "));
      lines.push("");
    }
    if (analysis.features && analysis.features.length) {
      lines.push("**Feature keys:** " + analysis.features.map(f => f.key).slice(0, 20).join(", "));
      lines.push("");
    }
    lines.push("Detail lengkap ada di `analisis.json`.");
  } else if (analysis && analysis.error) {
    lines.push("_Analisis gagal: " + analysis.error + "_");
  } else {
    lines.push("_Analisis tidak dijalankan._");
  }
  lines.push("");

  lines.push("## Host / server yang terdeteksi");
  lines.push("");
  for (const [host, info] of [...hosts.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const cats = [...info.categories].join(", ");
    lines.push(`### \`${host}\``);
    lines.push(`- Request: **${info.count}**`);
    lines.push(`- Kategori: ${cats}`);
    lines.push(`- Contoh URL:`);
    for (const s of info.samples) lines.push(`  - ${s}`);
    lines.push("");
  }
  lines.push("## Endpoint API (snapshot saat collect) — Poin 4");
  lines.push("");
  // Ringkasan jenis API dari manifest
  const apiKindBag = {};
  for (const r of api) {
    const k = r.apiKind || "unknown";
    apiKindBag[k] = (apiKindBag[k] || 0) + 1;
  }
  if (Object.keys(apiKindBag).length) {
    lines.push("| Jenis API (semantik) | Jumlah |");
    lines.push("|----------------------|--------|");
    for (const [k, n] of Object.entries(apiKindBag).sort((a, b) => b[1] - a[1])) {
      lines.push(`| \`${k}\` | ${n} |`);
    }
    lines.push("");
  }
  if (!apiEndpoints.length) {
    lines.push("_Tidak ada response API yang tertangkap saat collect._");
  } else {
    lines.push("File body disimpan di `server/api/`. Ini **snapshot** saat capture, bukan live server.");
    lines.push("");
    for (const r of api.slice(0, 80)) {
      lines.push(`- \`${r.url}\``);
      const bits = [
        r.localPath ? `local: \`${r.localPath}\`` : null,
        r.status != null ? `status ${r.status}` : null,
        r.size != null ? `${r.size} byte` : null,
        r.apiKind ? `kind: **${r.apiKind}**` : null,
        r.apiConfidence ? `conf: ${r.apiConfidence}` : null
      ].filter(Boolean);
      lines.push(`  - ${bits.join(" · ")}`);
      if (r.apiFields && Object.keys(r.apiFields).length) {
        const f = r.apiFields;
        const parts = [];
        if (f.balance !== undefined) parts.push(`balance=${f.balance}`);
        if (f.bet !== undefined) parts.push(`bet=${f.bet}`);
        if (f.win !== undefined) parts.push(`win=${f.win}`);
        if (f.session !== undefined) parts.push(`session=${f.session}`);
        if (f.symbols) parts.push("symbols=yes");
        if (f.feature) parts.push("feature=yes");
        if (parts.length) lines.push(`  - fields: ${parts.join(", ")}`);
      }
    }
  }
  lines.push("");
  lines.push("## Struktur ZIP");
  lines.push("");
  lines.push("```");
  lines.push("index.html");
  lines.push("assets/");
  lines.push("  symbols/          # Symbol / icon slot");
  lines.push("  reels/            # Reel graphics");
  lines.push("  ui/               # Tombol, panel, HUD");
  lines.push("  backgrounds/      # Background scene");
  lines.push("  animations/       # Win anim, transition, video");
  lines.push("  particles/        # FX / particle");
  lines.push("  atlases/          # Sprite atlas / Spine");
  lines.push("  audio/            # BGM, SFX, win sounds");
  lines.push("  config/           # Paytable, symbol def, features");
  lines.push("  js/               # Engine + game logic");
  lines.push("  css/ fonts/ images/ html/ data/ other/");
  lines.push("server/");
  lines.push("  api/              # Snapshot response API");
  lines.push("manifest.json");
  lines.push("keterangan.json");
  lines.push("KETERANGAN.md");
  lines.push("README.md");
  lines.push("```");
  lines.push("");
  lines.push("## Catatan penting");
  lines.push("");
  lines.push("- Hanya resource yang **dikirim ke browser** saat collect.");
  lines.push("- API di folder `server/` adalah **salinan response**, bukan koneksi live.");
  lines.push("- Logic server, database, DRM, multiplayer real-time **tidak** ikut.");
  lines.push("- Pakai hanya pada game yang kamu miliki / berizin.");
  lines.push("");

  const keteranganJson = {
    target,
    collectedAt: new Date().toISOString(),
    totals: {
      all: manifest.length,
      game: game.length,
      api: api.length,
      server: server.length
    },
    slotSubCategories: subCounts,
    analysisSummary: analysis?.summary || null,
    engine: analysis?.engine
      ? {
          name: analysis.engine.engine,
          confidence: analysis.engine.confidence,
          score: analysis.engine.score,
          ranked: analysis.engine.ranked?.slice(0, 5) || []
        }
      : null,
    hosts: [...hosts.entries()].map(([host, info]) => ({
      host,
      count: info.count,
      categories: [...info.categories],
      samples: info.samples
    })),
    apiEndpoints,
    folders: {
      game: "assets/",
      slotSub: [
        "assets/symbols/", "assets/reels/", "assets/ui/", "assets/backgrounds/",
        "assets/animations/", "assets/particles/", "assets/atlases/",
        "assets/audio/", "assets/config/", "assets/js/", "assets/css/",
        "assets/fonts/", "assets/images/", "assets/html/", "assets/data/", "assets/other/"
      ],
      api: "server/api/",
      server: "server/",
      docs: ["KETERANGAN.md", "keterangan.json", "manifest.json", "README.md"]
    },
    note: "Asset game diklasifikasi ke sub-folder slot (symbols, reels, ui, dll). API/server = snapshot saja."
  };

  return { md: lines.join("\n"), json: keteranganJson };
}

