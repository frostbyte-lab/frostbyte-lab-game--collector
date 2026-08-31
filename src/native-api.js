const NATIVE_CONFIG = {
  schema_version: "1.0",
  game_id: "frostbyte-collector",
  package_version: "1.0.0",
  runtime: "native",
  asset_mode: "local",
  api_base: "/api/game",
  currency: "points",
  limits: { min_bet: 1, max_bet: 500, default_bet: 10 },
  features: ["collector-dashboard", "validation-center", "synthetic-native-api", "offline-shell"],
  telemetry: { enabled: true, pii: false }
};

const sessions = new Map();
const players = new Map();
const MAX_BODY_BYTES = 32 * 1024;
const MAX_PLAYER_ID = 80;
const uuid = () => globalThis.crypto?.randomUUID?.() || `native-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const timestamp = () => new Date().toISOString();
const json = (payload, status = 200) => Response.json(payload, { status, headers: { "Cache-Control": "no-store", "X-Native-Api": "1" } });
const fail = (error_code, message, status) => json({ ok: false, error_code, message, server_timestamp: timestamp() }, status);

function stateFor(playerId = "demo-player") {
  if (!players.has(playerId)) players.set(playerId, { player_id: playerId, status: "active", display_name: "Demo Operator", balance: 1250, version: 0, ledger: [], history: [], rounds: [], results: new Map(), idempotency: new Map() });
  return players.get(playerId);
}
function bodyOf(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY_BYTES) return Promise.reject(Object.assign(new Error("Body terlalu besar."), { code: "BODY_TOO_LARGE", status: 413 }));
  return request.json().catch(() => ({}));
}
function sessionOf(request) {
  const sessionId = request.headers.get("X-Native-Session") || "";
  const session = sessions.get(sessionId);
  if (!session || session.status !== "active" || session.expiresAt <= Date.now()) return null;
  return session;
}
function requireSession(request) { const session = sessionOf(request); if (!session) throw Object.assign(new Error("Sesi native telah berakhir."), { code: "SESSION_EXPIRED", status: 401 }); return session; }
function requestKey(input) { return String(input.idempotency_key || input.request_id || "").slice(0, 160); }
function addHistory(state, event_type, reference_id, request_id = null) { state.history.unshift({ event_id: uuid(), player_id: state.player_id, event_type, reference_id, request_id, created_at: timestamp() }); }
function postLedger(state, input, amount, before, after) { const entry = { ledger_id: uuid(), player_id: state.player_id, request_id: input.request_id, amount, balance_before: before, balance_after: after, status: "posted", created_at: timestamp() }; state.ledger.unshift(entry); state.version += 1; return entry; }
function transaction(state, input, amount, event_type, extra = {}) {
  const key = requestKey(input); if (!key || !input.request_id) throw Object.assign(new Error("request_id dan idempotency_key wajib diisi."), { code: "INVALID_REQUEST", status: 400 });
  if (state.idempotency.has(key)) return state.idempotency.get(key);
  const before = state.balance; const after = before + amount;
  if (after < 0) throw Object.assign(new Error("Saldo tidak mencukupi."), { code: "INSUFFICIENT_BALANCE", status: 422 });
  state.balance = after; const ledger = postLedger(state, input, amount, before, after); addHistory(state, event_type, ledger.ledger_id, input.request_id);
  const result = { ok: true, request_id: input.request_id, idempotency_key: key, session_id: input.session_id, player_id: state.player_id, server_timestamp: timestamp(), balance_before: before, balance_after: after, status: "posted", ledger_reference: ledger.ledger_id, ...extra };
  state.idempotency.set(key, result); return result;
}

export async function handleNativeApi(request, env = {}) {
  const url = new URL(request.url); const path = url.pathname.replace(/^\/api\/game/, "") || "/";
  const production = String(env.NATIVE_API_MODE || "demo").toLowerCase() === "production";
  if (production) return fail("NATIVE_API_NOT_CONFIGURED", "Native substitute hanya demo; hubungkan database/ledger terotorisasi sebelum produksi.", 503);
  if (request.method === "GET" && path === "/health") return json({ ok: true, service: "native-game-api", runtime: "synthetic-native-substitute", version: NATIVE_CONFIG.package_version, persistence: "in-memory-demo-only", production_note: "Bind an authorized database/ledger before production." });
  if (request.method === "GET" && path === "/config") return json(NATIVE_CONFIG);
  if (request.method === "POST" && path === "/init") return json({ ...NATIVE_CONFIG, initialized_at: timestamp() });
  let input = {};
  if (request.method === "POST") { try { input = await bodyOf(request); } catch (error) { return fail(error.code || "INVALID_JSON", error.message || "Body tidak valid.", error.status || 400); } }
  if (request.method === "POST" && path === "/session") {
    if (env.NATIVE_API_KEY && request.headers.get("X-Native-Api-Key") !== env.NATIVE_API_KEY) return fail("UNAUTHORIZED", "API key native tidak valid.", 401);
    const rawPlayerId = String(input.player_id || "demo-player").trim();
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(rawPlayerId)) return fail("INVALID_PLAYER", "player_id tidak valid.", 400);
    const playerId = rawPlayerId; const session_id = uuid(); const expiresAt = Date.now() + 30 * 60 * 1000;
    sessions.set(session_id, { session_id, player_id: playerId, expiresAt, status: "active" });
    const state = stateFor(playerId); addHistory(state, "session.create", session_id, input.request_id || null);
    return json({ ok: true, session_id, player_id: playerId, expires_at: new Date(expiresAt).toISOString(), status: "active" });
  }
  let session;
  try { session = requireSession(request); } catch (error) { return fail(error.code, error.message, error.status); }
  const state = stateFor(session.player_id); input.session_id = session.session_id; input.player_id = state.player_id;
  if (request.method === "POST" && path === "/session/refresh") { session.expiresAt = Date.now() + 30 * 60 * 1000; addHistory(state, "session.refresh", session.session_id, input.request_id || null); return json({ ok: true, session_id: session.session_id, expires_at: new Date(session.expiresAt).toISOString(), status: "active" }); }
  if (request.method === "POST" && path === "/session/end") { session.status = "ended"; addHistory(state, "session.end", session.session_id, input.request_id || null); return json({ ok: true, session_id: session.session_id, status: "ended" }); }
  if (request.method === "GET" && path === "/player") return json({ ok: true, data: { player_id: state.player_id, status: state.status, display_name: state.display_name } });
  if (request.method === "GET" && path === "/balance") return json({ ok: true, data: { player_id: state.player_id, currency: NATIVE_CONFIG.currency, available_balance: state.balance, version: state.version } });
  try {
    if (request.method === "POST" && path === "/bet") { const bet = Number(input.bet); if (!Number.isInteger(bet) || bet < NATIVE_CONFIG.limits.min_bet || bet > NATIVE_CONFIG.limits.max_bet) return fail("BET_OUT_OF_RANGE", "Nilai bet di luar batas.", 422); if (state.balance < bet) return fail("INSUFFICIENT_BALANCE", "Saldo tidak mencukupi.", 422); return json(transaction(state, input, -bet, "bet.authorize", { bet, round_id: uuid() })); }
    if (request.method === "POST" && path === "/spin") { const bet = Number(input.bet); if (!Number.isInteger(bet) || bet < NATIVE_CONFIG.limits.min_bet || bet > NATIVE_CONFIG.limits.max_bet) return fail("BET_OUT_OF_RANGE", "Nilai bet di luar batas.", 422); if (state.balance < bet) return fail("INSUFFICIENT_BALANCE", "Saldo tidak mencukupi.", 422); const roll = (Number(input.seed) || Date.now()) % 10; const win_amount = roll >= 7 ? bet * (roll === 9 ? 5 : 2) : 0; const round_id = uuid(); const result_id = uuid(); const response = transaction(state, input, -bet + win_amount, "round.spin", { bet, round_id, result_id, result: { result_id, round_id, symbols: [roll % 5, (roll + 1) % 5, (roll + 2) % 5], win_amount, status: "posted" } }); state.results.set(result_id, response.result); state.rounds.unshift({ round_id, player_id: state.player_id, bet, result: result_id, status: "posted", created_at: timestamp() }); return json(response); }
    if (request.method === "GET" && path.startsWith("/result/")) { const result = state.results.get(path.split("/").pop()); return result ? json({ ok: true, data: result }) : fail("INVALID_REQUEST", "Result tidak ditemukan.", 404); }
    if (request.method === "GET" && path === "/history") return json({ ok: true, data: { events: state.history.slice(0, 50), rounds: state.rounds.slice(0, 20), ledger: state.ledger.slice(0, 20) } });
    if (request.method === "POST" && path === "/collect") { const key = requestKey(input); if (!key || !input.request_id) return fail("INVALID_REQUEST", "request_id dan idempotency_key wajib diisi.", 400); if (!state.idempotency.has(key)) { const accepted = { ok: true, artifact_id: String(input.artifact_id || uuid()).slice(0, 120), status: "accepted", validation_id: uuid() }; state.idempotency.set(key, accepted); addHistory(state, "collect.create", accepted.artifact_id, input.request_id); } return json(state.idempotency.get(key)); }
    if (request.method === "POST" && path === "/bonus") return json(transaction(state, input, Math.max(1, Number(input.amount) || 25), "bonus.claim", { bonus_id: String(input.bonus_id || "welcome").slice(0, 80) }));
  } catch (error) { return fail(error.code || "INTERNAL_ERROR", error.message || "Internal error", error.status || 500); }
  return fail("INVALID_REQUEST", `Endpoint tidak didukung: ${request.method} ${path}`, 404);
}
