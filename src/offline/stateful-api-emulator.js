/**
 * Stateful local API emulator for offline sandbox previews.
 * It intentionally models a small, deterministic contract and does not
 * represent a real-money backend or guarantee compatibility with every game.
 */

const DEFAULTS = {
  initialBalance: 100000,
  currency: "IDR",
  defaultBet: 100,
  minBet: 1,
  maxBet: 100000,
  seed: 0x5f3759df
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-GC-Mock": "stateful-v1"
    }
  });
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function createPrng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function routeOf(url) {
  const path = new URL(url, "https://gc.offline.local/").pathname.toLowerCase();
  if (/\/(?:init|gameinfo|gamedata)\/?$/.test(path)) return "init";
  if (/\/(?:balance|gamewallet)\/?$/.test(path)) return "balance";
  if (/\/(?:spin|bet|play)\/?$/.test(path)) return "spin";
  if (/\/(?:session|verifysession)\/?$/.test(path)) return "session";
  return null;
}

function requestBody(request) {
  if (!request || request.method === "GET" || request.method === "HEAD") return Promise.resolve({});
  return request.clone().json().catch(() => request.clone().text().then((text) => {
    try { return JSON.parse(text || "{}"); } catch (_) { return {}; }
  }));
}

export function createStatefulApiEmulator(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const random = createPrng(numberOr(config.seed, DEFAULTS.seed));
  const state = {
    sessionId: config.sessionId || `sandbox-${Date.now().toString(36)}`,
    token: config.token || "gc-offline-token",
    balance: Math.max(0, numberOr(config.initialBalance, DEFAULTS.initialBalance)),
    currency: config.currency,
    round: 0,
    lastWin: 0,
    history: []
  };

  function sessionPayload() {
    return {
      ok: true,
      __gcMock: true,
      session: { id: state.sessionId, ok: true },
      token: state.token,
      si: state.sessionId,
      tk: state.token,
      balance: state.balance,
      bl: state.balance,
      currency: state.currency
    };
  }

  function initPayload() {
    return {
      ok: true,
      __gcMock: true,
      gameInfo: { offline: true, mode: "stateful-sandbox" },
      data: { gameInfo: { offline: true }, balance: state.balance, currency: state.currency },
      dt: { game: "offline", bl: state.balance },
      balance: state.balance,
      bl: state.balance,
      currency: state.currency
    };
  }

  function balancePayload() {
    return {
      ok: true,
      __gcMock: true,
      data: { balance: state.balance, currency: state.currency },
      balance: state.balance,
      bl: state.balance,
      credit: state.balance,
      currency: state.currency,
      round: state.round
    };
  }

  async function spin(request) {
    const body = await requestBody(request);
    const bet = numberOr(body.bet ?? body.betAmount ?? body.amount ?? body.stake, config.defaultBet);
    if (!Number.isFinite(bet) || bet < config.minBet || bet > config.maxBet) {
      return jsonResponse({ ok: false, __gcMock: true, error: "INVALID_BET", message: "Bet di luar batas emulator." }, 400);
    }
    if (bet > state.balance) {
      return jsonResponse({ ok: false, __gcMock: true, error: "INSUFFICIENT_BALANCE", balance: state.balance, bl: state.balance }, 409);
    }

    state.round += 1;
    state.balance -= bet;
    const symbols = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => 1 + Math.floor(random() * 9)));
    const win = random() < 0.2 ? bet * (2 + Math.floor(random() * 5)) : 0;
    state.lastWin = win;
    state.balance += win;
    const result = {
      roundId: `${state.sessionId}-${state.round}`,
      win,
      winAmount: win,
      bet,
      symbols,
      rl: symbols,
      balance: state.balance,
      bl: state.balance,
      si: state.sessionId,
      currency: state.currency
    };
    state.history.unshift(result);
    state.history.length = Math.min(state.history.length, 50);
    return jsonResponse({ ok: true, __gcMock: true, data: result, dt: result, ...result });
  }

  async function handle(requestOrUrl, init = {}) {
    const request = requestOrUrl instanceof Request ? requestOrUrl : new Request(requestOrUrl, init);
    const route = routeOf(request.url);
    if (!route) return null;
    if (route === "session") return jsonResponse(sessionPayload());
    if (route === "init") return jsonResponse(initPayload());
    if (route === "balance") return jsonResponse(balancePayload());
    return spin(request);
  }

  function snapshot() {
    return { ...state, history: state.history.map((item) => ({ ...item, symbols: item.symbols.map((row) => [...row]) })) };
  }

  return { handle, snapshot, state };
}

export function installStatefulApiEmulator(options = {}) {
  const emulator = createStatefulApiEmulator(options);
  const originalFetch = globalThis.fetch?.bind(globalThis);
  if (!originalFetch) throw new Error("fetch tidak tersedia pada runtime lokal");
  globalThis.fetch = async (input, init) => {
    const response = await emulator.handle(input, init);
    return response || originalFetch(input, init);
  };
  return {
    emulator,
    restore() { globalThis.fetch = originalFetch; }
  };
}

export { routeOf };
export default createStatefulApiEmulator;
