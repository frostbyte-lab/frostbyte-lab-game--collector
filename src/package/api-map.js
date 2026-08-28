/**
 * Build api-map.json from collect manifest + optional snapshot bodies in zipFiles.
 * Digunakan Sandbox mock agar endpoint nyata (bukan hanya pattern generik) punya mapping.
 */

function pathnameOf(url) {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    const s = String(url || "");
    const m = s.match(/https?:\/\/[^/]+(\/[^?#]*)/i);
    return m ? m[1] : s;
  }
}

function kindFromEntry(r) {
  if (r.apiKind && r.apiKind !== "unknown") return r.apiKind;
  const u = String(r.url || r.localPath || "").toLowerCase();
  if (/spin|bet|wager|play/.test(u)) return "spin";
  if (/balance|wallet|credit/.test(u)) return "balance";
  if (/session|auth|token|login|verifysession/.test(u)) return "session";
  if (/init|launch|config|gamedata|gameinfo/.test(u)) return "init";
  if (/history|result|settle/.test(u)) return "result";
  return "api";
}

function mockTemplateForKind(kind) {
  const balance = 100000;
  const session = { id: "sandbox-local", ok: true, si: "sandbox-local", tk: "sandbox-token" };
  // Multi-provider (PG Soft / Asia aggregator): dt + err + nested data + flat keys
  const wrap = (data) => ({
    ok: true,
    mock: true,
    __gcMock: true,
    err: null,
    error: 0,
    code: 0,
    status: "ok",
    success: true,
    message: "ok",
    dt: data,
    data: { ...data },
    result: data,
    ...data
  });

  switch (kind) {
    case "spin":
    case "spin-request":
    case "spin-result": {
      const win = 0;
      const symbols = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9]
      ];
      return wrap({
        win,
        winAmount: win,
        totalWin: win,
        balance,
        bl: balance,
        credit: balance,
        symbols,
        reels: symbols,
        rl: symbols,
        orl: symbols,
        si: session.si,
        tk: session.tk,
        roundId: "r-" + Date.now(),
        ct: Date.now(),
        st: 1,
        nst: 1,
        ctw: win
      });
    }
    case "balance":
      return wrap({
        balance,
        bl: balance,
        credit: balance,
        currency: "IDR",
        tb: balance,
        cb: balance
      });
    case "session":
    case "auth":
      return wrap({
        session,
        si: session.si,
        tk: session.tk,
        token: "sandbox-token",
        accessToken: "sandbox-token",
        balance,
        bl: balance,
        playerId: "p-sandbox",
        uid: "p-sandbox",
        geu: "",
        lau: ""
      });
    case "init":
    case "launch":
      return wrap({
        session,
        si: session.si,
        tk: session.tk,
        balance,
        bl: balance,
        config: { rtp: 96, lines: 20, betLevels: [100, 200, 500, 1000] },
        gameInfo: { name: "sandbox-game", offline: true },
        symbols: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        wt: "C",
        fb: null
      });
    case "history":
    case "result":
      return wrap({ items: [], list: [], balance, bl: balance, hist: [] });
    default:
      return wrap({ balance, bl: balance, session, si: session.si, tk: session.tk });
  }
}

/**
 * @param {Array} manifest
 * @param {Record<string, Uint8Array|string>} [zipFiles] — optional, baca snapshot body
 */
export function buildApiMap(manifest = [], zipFiles = null) {
  const endpoints = [];
  const seen = new Set();

  for (const r of manifest || []) {
    if (!r) continue;
    const cat = r.category || "";
    const urlL = String(r.url || "").toLowerCase();
    const pathL = String(r.localPath || "").toLowerCase();
    // Juga tangkap snapshot yang tersimpan di assets/ tapi URL-nya API (session/balance/spin)
    const looksApiUrl =
      /\/web-api\/|\/game-api\/|\/api\/|verifysession|gamewallet|gameinfo|\/spin|\/balance|\/session/i.test(urlL) ||
      /api\./i.test(urlL);
    const isApi =
      cat === "api" ||
      cat === "server" ||
      r.type === "xhr" ||
      r.type === "fetch" ||
      /server\/api/i.test(pathL) ||
      looksApiUrl;
    if (!isApi) continue;
    // Skip pure static CDN images even if type xhr (edge)
    if (/\.(png|jpe?g|gif|webp|mp3|ogg|woff2?)(\?|$)/i.test(urlL) && !looksApiUrl) continue;

    const url = r.url || "";
    const path = pathnameOf(url);
    const key = path + "||" + (r.localPath || "");
    if (seen.has(key)) continue;
    seen.add(key);

    const kind = kindFromEntry(r);
    let snapshot = null;

    // Coba ambil body snapshot dari zip (server/api/...)
    if (zipFiles && r.localPath && zipFiles[r.localPath]) {
      try {
        const raw = zipFiles[r.localPath];
        const text =
          typeof raw === "string"
            ? raw
            : new TextDecoder().decode(raw.slice ? raw.slice(0, 120000) : raw);
        const t = text.trim();
        if (t.startsWith("{") || t.startsWith("[")) {
          snapshot = JSON.parse(t.length > 200000 ? t.slice(0, 200000) : t);
        }
      } catch {
        /* ignore */
      }
    }

    endpoints.push({
      url,
      path,
      pathLower: path.toLowerCase(),
      method_hint: r.type || "fetch",
      status: r.status || 200,
      localPath: r.localPath || null,
      kind,
      confidence: r.apiConfidence || "low",
      fields: r.apiFields || null,
      topKeys: r.apiTopKeys || null,
      contract: r.apiContract || null,
      hasSnapshot: Boolean(snapshot),
      // Snapshot lebih dalam (session/init perlu field lengkap)
      snapshot: snapshot && typeof snapshot === "object"
        ? (Array.isArray(snapshot)
            ? snapshot.slice(0, 50)
            : Object.fromEntries(Object.entries(snapshot).slice(0, 80)))
        : null,
      mockTemplate: mockTemplateForKind(kind)
    });
  }

  // Route table: path substring → endpoint index (untuk matcher cepat di sandbox)
  const routes = endpoints.map((ep, i) => ({
    i,
    path: ep.pathLower,
    kind: ep.kind,
    hasSnapshot: ep.hasSnapshot
  }));

  const withSnap = endpoints.filter((e) => e.hasSnapshot).length;
  const byKind = {};
  for (const ep of endpoints) {
    byKind[ep.kind] = (byKind[ep.kind] || 0) + 1;
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    note:
      "Peta endpoint API dari collect. Sandbox: snapshot > mockTemplate. Hybrid online: biarkan network untuk path ini.",
    hybrid: {
      mode: "snapshot-or-mock",
      tip: "Preview Hybrid = asset lokal + API network; Sandbox = snapshot/mock dari map ini"
    },
    totals: {
      endpoints: endpoints.length,
      withSnapshot: withSnap,
      byKind
    },
    byKind,
    endpoints,
    routes
  };
}

/**
 * Resolve mock body for a request URL using api-map.
 * Pure helper (juga bisa dipakai di dokumentasi); runtime browser punya salinan di shim.
 */
export function resolveMockFromApiMap(apiMap, requestUrl) {
  if (!apiMap || !apiMap.endpoints) return null;
  let path = "";
  try {
    path = new URL(requestUrl, "https://local.invalid").pathname.toLowerCase();
  } catch {
    path = String(requestUrl || "").toLowerCase();
  }
  let best = null;
  let bestScore = 0;
  for (const ep of apiMap.endpoints) {
    const p = ep.pathLower || "";
    if (!p) continue;
    if (path === p) {
      best = ep;
      bestScore = 1000;
      break;
    }
    if (p.length > 3 && path.includes(p)) {
      const score = p.length;
      if (score > bestScore) {
        bestScore = score;
        best = ep;
      }
    }
    // match last segment
    const seg = p.split("/").filter(Boolean).pop();
    if (seg && seg.length > 2 && path.includes(seg) && bestScore < seg.length) {
      bestScore = seg.length;
      best = ep;
    }
  }
  if (!best) return null;
  if (best.snapshot) return { from: "snapshot", kind: best.kind, body: best.snapshot, endpoint: best };
  return { from: "template", kind: best.kind, body: best.mockTemplate || mockTemplateForKind(best.kind), endpoint: best };
}
