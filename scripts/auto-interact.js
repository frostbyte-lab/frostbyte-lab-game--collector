/**
 * Strict auto-interact for Game Collector Pro (GitHub Actions / local)
 * - Deteksi tombol ketat: keyword + tag + visible + area + posisi
 * - Play sekali → Spin N× (tunggu settle) → History sekali → Close
 * - Main frame + iframe
 *
 * Env:
 *   AUTO_SPINS      default 3
 *   AUTO_HISTORY    default 1  (0 = skip)
 *   SPIN_DELAY_MS   default 2200
 */

export const PLAY_KW = [
  "play", "start", "mulai", "continue", "lanjut", "main", "go", "enter",
  "tap to play", "click to play", "klik untuk main", "start game", "play now",
  "mulai game", "lanjutkan", "ok", "yes", "accept", "agree", "demo", "begin"
];

export const SPIN_KW = [
  "spin", "putar", "roll", "bet", "pasang", "place bet", "spin now",
  "auto spin", "max bet", "confirm", "play spin", "start spin"
];

export const HISTORY_KW = [
  "history", "riwayat", "record", "bet history", "game history",
  "round history", "log", "detail", "hasil", "result history"
];

export const CLOSE_KW = [
  "close", "tutup", "x", "ok", "done", "back", "kembali", "cancel", "batal"
];

/** Evaluate inside one frame: score + click top candidates */
async function detectAndClickInFrame(frame, keywords, label, preferCenter = false) {
  try {
    return await frame.evaluate(
      ({ keywords, preferCenter, label }) => {
        const selectors =
          "button, a, div, span, input[type=button], input[type=submit], [role=button], .btn, .button";
        const all = document.querySelectorAll(selectors);
        const scored = [];

        for (const el of all) {
          try {
            const text = (
              (el.textContent || "") + " " +
              (el.getAttribute("aria-label") || "") + " " +
              (el.getAttribute("title") || "") + " " +
              (el.id || "") + " " +
              (typeof el.className === "string" ? el.className : "") + " " +
              (el.getAttribute("data-testid") || "") + " " +
              (el.name || "")
            ).toLowerCase().replace(/\s+/g, " ").trim();

            let kwHit = 0;
            for (const k of keywords) {
              if (text.includes(k)) kwHit += k.length >= 4 ? 3 : 2;
            }
            if (kwHit === 0) continue;

            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
            if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;

            const r = el.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) continue;
            if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;

            const area = r.width * r.height;
            const tag = (el.tagName || "").toLowerCase();
            let score = kwHit * 10;
            if (tag === "button" || el.getAttribute("role") === "button") score += 15;
            else if (tag === "a" || tag === "input") score += 8;
            else score += 3;

            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const midX = innerWidth / 2;
            const midY = innerHeight * 0.65;
            const dist = Math.hypot(cx - midX, cy - midY);
            if (preferCenter) score += Math.max(0, 40 - dist / 15);
            score += Math.min(20, area / 800);

            scored.push({
              score,
              text: text.slice(0, 60),
              tag,
              x: Math.round(cx),
              y: Math.round(cy)
            });
            el.__gcScore = score;
          } catch {}
        }

        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, 5);
        let clicked = 0;
        const candidates = Array.from(all)
          .filter((el) => el.__gcScore != null)
          .sort((a, b) => (b.__gcScore || 0) - (a.__gcScore || 0));
        for (const el of candidates.slice(0, 3)) {
          try {
            el.click();
            clicked++;
          } catch {}
        }
        return { label, found: scored.length, clicked, top };
      },
      { keywords, preferCenter, label }
    );
  } catch (e) {
    return {
      label,
      found: 0,
      clicked: 0,
      error: String(e?.message || e).slice(0, 120)
    };
  }
}

async function runOnAllFrames(page, keywords, label, preferCenter = false) {
  const results = [];
  results.push(await detectAndClickInFrame(page.mainFrame(), keywords, label + ":main", preferCenter));
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const fu = frame.url();
    if (!fu || fu === "about:blank" || fu.startsWith("chrome")) continue;
    results.push(await detectAndClickInFrame(frame, keywords, label + ":iframe", preferCenter));
  }
  return results;
}

/**
 * Pipeline ketat: Play → Spin×N + settle → History → Close
 */
export async function runStrictAutoInteract(page, opts = {}) {
  const autoSpins = Math.max(
    0,
    parseInt(String(opts.autoSpins ?? process.env.AUTO_SPINS ?? "3"), 10) || 0
  );
  const autoHistory =
    String(opts.autoHistory ?? process.env.AUTO_HISTORY ?? "1") !== "0";
  const spinDelayMs = Math.max(
    800,
    parseInt(String(opts.spinDelayMs ?? process.env.SPIN_DELAY_MS ?? "2200"), 10) || 2200
  );

  const log = [];
  const push = (msg, data) => {
    console.log("PROGRESS: auto_interact", data ? `${msg} ${JSON.stringify(data)}` : msg);
    log.push({ t: Date.now(), msg, data });
  };

  push("start", { autoSpins, autoHistory, spinDelayMs });

  // 1) Play / Start
  const playRes = await runOnAllFrames(page, PLAY_KW, "play", false);
  push("play", {
    frames: playRes.length,
    totalClicked: playRes.reduce((s, r) => s + (r.clicked || 0), 0),
    top: playRes.flatMap((r) => r.top || []).slice(0, 3)
  });
  await page.waitForTimeout(1800);

  // 2) Spin loop + settle
  for (let i = 1; i <= autoSpins; i++) {
    const spinRes = await runOnAllFrames(page, SPIN_KW, `spin_${i}`, true);
    push(`spin_attempt_${i}`, {
      clicked: spinRes.reduce((s, r) => s + (r.clicked || 0), 0),
      top: spinRes.flatMap((r) => r.top || []).slice(0, 3)
    });
    await page.waitForTimeout(spinDelayMs);
    try {
      await page.waitForLoadState("networkidle", { timeout: 2500 });
    } catch {}
  }

  // 3) History sekali
  if (autoHistory) {
    const histRes = await runOnAllFrames(page, HISTORY_KW, "history", false);
    push("history_open", {
      clicked: histRes.reduce((s, r) => s + (r.clicked || 0), 0)
    });
    await page.waitForTimeout(1500);
    const closeRes = await runOnAllFrames(page, CLOSE_KW, "history_close", false);
    push("history_close", {
      clicked: closeRes.reduce((s, r) => s + (r.clicked || 0), 0)
    });
    await page.waitForTimeout(800);
  }

  push("done");
  return { log, autoSpins, autoHistory, spinDelayMs };
}

/** Compat: hanya Play (seperti autoClickAllFrames lama) */
export async function autoClickPlayOnly(page) {
  return runOnAllFrames(page, PLAY_KW, "play_only", false);
}
