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
  const session = { id: "sandbox-local", ok: true, si: "sandbox-local" };
  // Bentuk respons multi-provider (umum di slot Asia): dt/err + data nested
  const wrap = (data) => ({
    ok: true,
    mock: true,
    __gcMock: true,
    err: null,
    error: 0,
    code: 0,
    status: "ok",
    dt: data,
    data,
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
        balance,
        bl: balance,
        credit: balance,
        symbols,
        reels: symbols,
        rl: symbols,
        si: session.si,
        roundId: "r-" + Date.now(),
        ct: Date.now()
      });
    }
    case "balance":
      return wrap({ balance, bl: balance, credit: balance, currency: "IDR" });
    case "session":
    case "auth":
      return wrap({
        session,
        token: "sandbox-token",
        accessToken: "sandbox-token",
        balance,
        bl: balance,
        playerId: "p-sandbox"
      });
    case "init":
    case "launch":
      return wrap({
        session,
        balance,
        bl: balance,
        config: { rtp: 96, lines: 20, betLevels: [100, 200, 500, 1000] },
        gameInfo: { name: "sandbox-game", offline: true },
        symbols: [1, 2, 3, 4, 5, 6, 7, 8, 9]
      });
    case "history":
    case "result":
      return wrap({ items: [], list: [], balance, bl: balance });
    default:
      return wrap({ balance, session });
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
    const isApi =
      cat === "api" ||
      cat === "server" ||
      r.type === "xhr" ||
      r.type === "fetch" ||
      /server\/api/i.test(r.localPath || "");
    if (!isApi) continue;

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
          snapshot = JSON.parse(t.length > 100000 ? t.slice(0, 100000) : t);
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
      hasSnapshot: Boolean(snapshot),
      // Snapshot dipangkas agar api-map.json tidak membengkak
      snapshot: snapshot && typeof snapshot === "object"
        ? (Array.isArray(snapshot) ? snapshot.slice(0, 20) : Object.fromEntries(Object.entries(snapshot).slice(0, 40)))
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

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    note:
      "Peta endpoint API dari collect. Sandbox memakai snapshot bila ada, else mockTemplate per kind.",
    totals: {
      endpoints: endpoints.length,
      withSnapshot: endpoints.filter((e) => e.hasSnapshot).length
    },
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
