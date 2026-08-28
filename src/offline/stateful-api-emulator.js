/**
 * Stateful local API emulator for offline sandbox previews.
 * It intentionally models a small, deterministic contract and does not
 * represent a real-money backend or guarantee compatibility with every game.
 */

import { installLocalApiRouter } from "./api-router.js";
import { getSafeStorage, saveSessionState, loadSessionState, clearSessionState, DEFAULT_STORAGE_KEY } from "./state-storage.js";

const DEFAULTS = {
  initialBalance: 100000,
  currency: "IDR",
  defaultBet: 100,
  minBet: 1,
  maxBet: 100000,
  seed: 0x5f3759df,
  payoutTable: { 3: 5, 2: 1 }
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
  const initial = seed >>> 0;
  let state = initial;
  const next = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  next.reset = () => { state = initial; };
  return next;
}

function routeOf(url) {
  const path = new URL(url, "https://gc.offline.local/").pathname.toLowerCase();
  if (/\/(?:init|gameinfo|gamedata)\/?$/.test(path)) return "init";
  if (/\/(?:balance|gamewallet)\/?$/.test(path)) return "balance";
  if (/\/(?:spin|bet|play)\/?$/.test(path)) return "spin";
  if (/\/(?:session|verifysession)\/?$/.test(path)) return "session";
  return null;
}

function evaluatePayout(symbols, bet, payoutTable = DEFAULTS.payoutTable) {
  const rows = Array.isArray(symbols) ? symbols : [];
  let bestMatch = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const counts = new Map();
    for (const symbol of row) counts.set(symbol, (counts.get(symbol) || 0) + 1);
    for (const count of counts.values()) bestMatch = Math.max(bestMatch, count);
  }
  const multiplier = Math.max(0, numberOr(payoutTable?.[bestMatch], 0));
  return { match: bestMatch, multiplier, win: bet * multiplier };
}

function requestBody(request) {
  if (!request || request.method === "GET" || request.method === "HEAD") return Promise.resolve({});
  return request.clone().json().catch(() => request.clone().text().then((text) => {
    try { return JSON.parse(text || "{}"); } catch (_) { return {}; }
  }));
}

export function createStatefulApiEmulator(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const seed = numberOr(config.seed, DEFAULTS.seed) >>> 0;
  const random = createPrng(seed);
  const storage = getSafeStorage(config.storage);
  const storageKey = String(config.storageKey || DEFAULT_STORAGE_KEY);
  const autoPersist = config.autoPersist !== false;
  const initialSessionId = config.sessionId || `sandbox-${Date.now().toString(36)}`;
  const initialToken = config.token || "gc-offline-token";
  const state = {
    sessionId: initialSessionId,
    token: initialToken,
    playerId: config.playerId || "sandbox-player",
    gameId: config.gameId || "sandbox-game",
    apiContract: config.apiContract || null,
    seed,
    createdAt: new Date().toISOString(),
    balance: Math.max(0, numberOr(config.initialBalance, DEFAULTS.initialBalance)),
    currency: config.currency,
    round: 0,
    lastWin: 0,
    history: []
  };

  function persist() {
    return saveSessionState(storage, state, storageKey);
  }

  function loadPersisted() {
    const saved = loadSessionState(storage, storageKey);
    if (!saved) return null;
    // Storage deliberately omits token; retain the current sandbox token.
    return restore({ ...saved, token: state.token });
  }

  function sessionPayload() {
    return {
      ok: true,
      __gcMock: true,
      session: { id: state.sessionId, ok: true },
      sessionId: state.sessionId,
      token: state.token,
      playerId: state.playerId,
      gameId: state.gameId,
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
      session: { id: state.sessionId, ok: true },
      token: state.token,
      playerId: state.playerId,
      gameId: state.gameId,
      gameInfo: { offline: true, mode: "stateful-sandbox", gameId: state.gameId },
      data: { gameInfo: { offline: true, gameId: state.gameId }, balance: state.balance, currency: state.currency },
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
      sessionId: state.sessionId,
      token: state.token,
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
    const bet = numberOr(body.bet ?? body.betAmount ?? body.amount ?? body.stake ?? body.data?.bet, config.defaultBet);
    if (!Number.isFinite(bet) || bet < config.minBet || bet > config.maxBet) {
      return jsonResponse({ ok: false, __gcMock: true, error: "INVALID_BET", message: "Bet di luar batas emulator." }, 400);
    }
    if (bet > state.balance) {
      return jsonResponse({ ok: false, __gcMock: true, error: "INSUFFICIENT_BALANCE", balance: state.balance, bl: state.balance }, 409);
    }

    state.round += 1;
    const balanceBefore = state.balance;
    state.balance -= bet;
    const symbols = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => 1 + Math.floor(random() * 9)));
    const payout = evaluatePayout(symbols, bet, config.payoutTable);
    const win = payout.win;
    state.lastWin = win;
    state.balance += win;
    const result = {
      roundId: `${state.sessionId}-${state.round}`,
      win,
      winAmount: win,
      totalWin: win,
      bet,
      balanceBefore,
      charged: bet,
      payoutMultiplier: payout.multiplier,
      matchedSymbols: payout.match,
      outcome: win > 0 ? "WIN" : "LOSS",
      symbols,
      reels: symbols,
      rl: symbols,
      balance: state.balance,
      bl: state.balance,
      si: state.sessionId,
      currency: state.currency
    };
    state.history.unshift(result);
    state.history.length = Math.min(state.history.length, 50);
    if (autoPersist) persist();
    return jsonResponse({ ok: true, __gcMock: true, data: result, dt: result, ...result });
  }

  async function handle(requestOrUrl, init = {}) {
    const request = requestOrUrl instanceof Request ? requestOrUrl : new Request(requestOrUrl, init);
    let route = routeOf(request.url);
    if (!route && state.apiContract?.target?.path) {
      const contractPath = String(state.apiContract.target.path).toLowerCase();
      const requestPath = new URL(request.url).pathname.toLowerCase();
      if (requestPath === contractPath || requestPath.includes(contractPath)) {
        route = state.apiContract.kind === "balance" ? "balance" : state.apiContract.kind === "spin" ? "spin" : "init";
      }
    }
    if (!route) return null;
    if (route === "session") return jsonResponse(sessionPayload());
    if (route === "init") return jsonResponse(initPayload());
    if (route === "balance") return jsonResponse(balancePayload());
    return spin(request);
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(state));
  }

  function restore(saved) {
    if (!saved || typeof saved !== "object") throw new TypeError("snapshot session tidak valid");
    if (!saved.sessionId || !saved.token) throw new TypeError("snapshot wajib memiliki sessionId dan token");
    state.sessionId = String(saved.sessionId);
    state.token = String(saved.token);
    state.playerId = String(saved.playerId || state.playerId);
    state.gameId = String(saved.gameId || state.gameId);
    state.apiContract = saved.apiContract || state.apiContract || null;
    state.createdAt = String(saved.createdAt || state.createdAt);
    state.balance = Math.max(0, numberOr(saved.balance, state.balance));
    state.currency = String(saved.currency || state.currency);
    state.round = Math.max(0, Math.floor(numberOr(saved.round, 0)));
    state.lastWin = Math.max(0, numberOr(saved.lastWin, 0));
    state.history = Array.isArray(saved.history) ? saved.history.slice(0, 50) : [];
    if (autoPersist) persist();
    return snapshot();
  }

  function reset(overrides = {}) {
    state.sessionId = overrides.sessionId || initialSessionId;
    state.token = overrides.token || initialToken;
    state.playerId = overrides.playerId || config.playerId || "sandbox-player";
    state.gameId = overrides.gameId || config.gameId || "sandbox-game";
    state.apiContract = overrides.apiContract || config.apiContract || null;
    state.createdAt = new Date().toISOString();
    state.balance = Math.max(0, numberOr(overrides.initialBalance, numberOr(config.initialBalance, DEFAULTS.initialBalance)));
    state.currency = overrides.currency || config.currency;
    state.round = 0;
    state.lastWin = 0;
    state.history = [];
    random.reset();
    if (autoPersist) persist();
    return snapshot();
  }

  function replay(options = {}) {
    reset({ ...options, initialBalance: options.initialBalance ?? config.initialBalance });
    return snapshot();
  }

  function setContract(contract) {
    state.apiContract = contract && typeof contract === "object" ? JSON.parse(JSON.stringify(contract)) : null;
    return state.apiContract;
  }

  return { handle, snapshot, restore, reset, replay, persist, loadPersisted, clearPersisted: () => clearSessionState(storage, storageKey), setContract, state };
}

export function installStatefulApiEmulator(options = {}) {
  const emulator = createStatefulApiEmulator(options);
  if (options.apiMap) {
    const installed = installLocalApiRouter({ emulator, apiMap: options.apiMap, mode: options.mode || "offline", replay: options.replay === true });
    return { emulator, router: installed.router, restore: installed.restore };
  }
  const originalFetch = globalThis.fetch?.bind(globalThis);
  if (!originalFetch) throw new Error("fetch tidak tersedia pada runtime lokal");
  globalThis.fetch = async (input, init) => {
    const response = await emulator.handle(input, init);
    return response || originalFetch(input, init);
  };
  return { emulator, restore() { globalThis.fetch = originalFetch; } };
}

export { routeOf };
export default createStatefulApiEmulator;
