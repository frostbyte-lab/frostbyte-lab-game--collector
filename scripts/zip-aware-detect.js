/**
 * Zip-aware + live-page detection profile
 * Membangun profil deteksi dari SEED_ZIP (jika ada) dan/atau halaman live.
 * Output dipakai untuk memperkaya keyword Spin/History dan daftar API kritis.
 *
 * Env:
 *   SEED_ZIP  path ke ZIP seed (opsional)
 */

import { readFileSync, existsSync } from "fs";
import { unzipSync, strFromU8 } from "fflate";

const DEFAULT_SPIN_KW = [
  "spin", "putar", "roll", "bet", "pasang", "place bet", "spin now",
  "auto spin", "max bet"
];

const DEFAULT_HISTORY_KW = [
  "history", "riwayat", "record", "bet history", "game history", "round history"
];

const DEFAULT_API_HINTS = [
  "spin", "bet", "wallet", "balance", "history", "launch", "session",
  "gamewallet", "gameinfo", "verifysession", "game-api", "game-proxy"
];

/**
 * Scan teks (HTML/JS/JSON) untuk keyword tombol & path API
 */
function harvestFromText(text, profile) {
  if (!text || typeof text !== "string") return;
  const lower = text.toLowerCase();

  for (const k of DEFAULT_SPIN_KW) {
    if (lower.includes(k) && !profile.spinKeywords.includes(k)) {
      profile.spinKeywords.push(k);
    }
  }
  for (const k of DEFAULT_HISTORY_KW) {
    if (lower.includes(k) && !profile.historyKeywords.includes(k)) {
      profile.historyKeywords.push(k);
    }
  }

  // Path-like API patterns
  const pathRe = /["'`](\/[a-z0-9_\-./]*(?:spin|bet|wallet|balance|history|launch|session|gameinfo|gamewallet|verifysession|game-api|game-proxy)[a-z0-9_\-./]*)["'`]/gi;
  let m;
  while ((m = pathRe.exec(text)) !== null) {
    const p = m[1].slice(0, 120);
    if (!profile.apiPaths.includes(p)) profile.apiPaths.push(p);
  }

  // Domain hints
  const hostRe = /https?:\/\/([a-z0-9.\-]+)/gi;
  while ((m = hostRe.exec(text)) !== null) {
    const h = m[1].toLowerCase();
    if (
      /pgsoft|pragmatic|jili|hacksaw|evolution|spribe|game-api|slot/i.test(h) &&
      !profile.apiHosts.includes(h)
    ) {
      profile.apiHosts.push(h);
    }
  }
}

/**
 * Build profile dari file ZIP seed
 */
export function buildProfileFromZip(zipPath) {
  const profile = {
    source: "zip",
    zipPath: zipPath || null,
    spinKeywords: [...DEFAULT_SPIN_KW],
    historyKeywords: [...DEFAULT_HISTORY_KW],
    apiPaths: [],
    apiHosts: [],
    filesScanned: 0
  };

  if (!zipPath || !existsSync(zipPath)) {
    profile.source = "zip-missing";
    return profile;
  }

  try {
    const buf = readFileSync(zipPath);
    const files = unzipSync(new Uint8Array(buf));
    for (const [name, data] of Object.entries(files)) {
      if (!/\.(html?|js|json|css|map)$/i.test(name)) continue;
      if (data.length > 2 * 1024 * 1024) continue;
      try {
        const text = strFromU8(data);
        harvestFromText(text, profile);
        profile.filesScanned++;
      } catch {}
    }
  } catch (e) {
    profile.error = String(e?.message || e).slice(0, 200);
  }

  return profile;
}

/**
 * Build / merge profile dari halaman live (Playwright page)
 */
export async function buildProfileFromLivePage(page) {
  const profile = {
    source: "live",
    spinKeywords: [...DEFAULT_SPIN_KW],
    historyKeywords: [...DEFAULT_HISTORY_KW],
    apiPaths: [],
    apiHosts: [],
    buttonHints: []
  };

  try {
    const snap = await page.evaluate(() => {
      const texts = [];
      document.querySelectorAll("button, a, [role=button], .btn").forEach((el) => {
        const t = (
          (el.textContent || "") +
          " " +
          (el.getAttribute("aria-label") || "") +
          " " +
          (el.id || "") +
          " " +
          (typeof el.className === "string" ? el.className : "")
        )
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80);
        if (t.length > 1) texts.push(t);
      });
      return {
        html: (document.documentElement?.outerHTML || "").slice(0, 400000),
        buttonTexts: texts.slice(0, 80),
        href: location.href
      };
    });

    harvestFromText(snap.html, profile);
    profile.buttonHints = snap.buttonTexts || [];
    profile.pageUrl = snap.href;

    // Enrich keywords from visible button text
    for (const t of profile.buttonHints) {
      for (const k of DEFAULT_SPIN_KW) {
        if (t.includes(k) && !profile.spinKeywords.includes(k)) profile.spinKeywords.push(k);
      }
      for (const k of DEFAULT_HISTORY_KW) {
        if (t.includes(k) && !profile.historyKeywords.includes(k)) profile.historyKeywords.push(k);
      }
    }
  } catch (e) {
    profile.error = String(e?.message || e).slice(0, 200);
  }

  return profile;
}

/**
 * Gabung profil ZIP + live
 */
export function mergeProfiles(...profiles) {
  const out = {
    source: "merged",
    spinKeywords: [...DEFAULT_SPIN_KW],
    historyKeywords: [...DEFAULT_HISTORY_KW],
    apiPaths: [],
    apiHosts: [],
    buttonHints: [],
    filesScanned: 0
  };

  for (const p of profiles) {
    if (!p) continue;
    for (const k of p.spinKeywords || []) {
      if (!out.spinKeywords.includes(k)) out.spinKeywords.push(k);
    }
    for (const k of p.historyKeywords || []) {
      if (!out.historyKeywords.includes(k)) out.historyKeywords.push(k);
    }
    for (const a of p.apiPaths || []) {
      if (!out.apiPaths.includes(a)) out.apiPaths.push(a);
    }
    for (const h of p.apiHosts || []) {
      if (!out.apiHosts.includes(h)) out.apiHosts.push(h);
    }
    if (p.buttonHints) out.buttonHints.push(...p.buttonHints);
    out.filesScanned += p.filesScanned || 0;
  }

  out.apiHints = DEFAULT_API_HINTS;
  return out;
}

/**
 * Entry: detectAll dari env SEED_ZIP + optional live page
 */
export async function detectAll(page = null) {
  const seedZip = process.env.SEED_ZIP || "";
  const fromZip = buildProfileFromZip(seedZip);
  let fromLive = null;
  if (page) {
    fromLive = await buildProfileFromLivePage(page);
  }
  const merged = mergeProfiles(fromZip, fromLive);

  console.log(
    "PROGRESS: profile_spin_kw",
    merged.spinKeywords.slice(0, 12).join(",")
  );
  console.log(
    "PROGRESS: profile_history_kw",
    merged.historyKeywords.slice(0, 8).join(",")
  );
  console.log(
    "PROGRESS: profile_apis",
    (merged.apiPaths.slice(0, 10).join(" | ") || "(none)") +
      (merged.apiHosts.length ? " hosts=" + merged.apiHosts.slice(0, 5).join(",") : "")
  );

  return merged;
}

/** URL dianggap critical (spin/bet/wallet/history) */
export function isCriticalApiUrl(url, profile = null) {
  const u = String(url || "").toLowerCase();
  const patterns = [
    /\/spin\b/, /\/bet\b/, /wallet/, /balance/, /history/,
    /gamewallet/, /gameinfo/, /verifysession/, /game-api/, /game-proxy/,
    /\/play\b/, /wager/, /do[_-]?spin/, /settle/, /roundresult/
  ];
  if (patterns.some((re) => re.test(u))) return true;
  if (profile?.apiPaths?.some((p) => u.includes(p.toLowerCase()))) return true;
  return false;
}

export function classifyApiResource(url, contentType = "") {
  const u = String(url || "").toLowerCase();
  if (/spin|do[_-]?spin|start[_-]?spin/.test(u)) return "spin";
  if (/bet|wager|stake/.test(u)) return "bet";
  if (/wallet|balance|credit|cashier/.test(u)) return "balance";
  if (/history|riwayat|record/.test(u)) return "history";
  if (/launch|gameinfo|gamedata|init/.test(u)) return "launch";
  if (/session|auth|token|verify/.test(u)) return "session";
  if ((contentType || "").includes("json")) return "json";
  return "other";
}
