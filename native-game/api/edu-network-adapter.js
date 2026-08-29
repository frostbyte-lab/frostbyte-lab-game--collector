import config from "../config/native-game-config.json" with { type: "json" };

const now = () => new Date().toISOString();
const uuid = () => globalThis.crypto?.randomUUID?.() || `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export class NativeApiError extends Error {
  constructor(error_code, message, status = 400) {
    super(message);
    this.name = "NativeApiError";
    this.error_code = error_code;
    this.status = status;
  }
}

export class NativeGameApi {
  constructor(seed = {}) {
    this.player = { player_id: seed.player_id || "demo-player", status: "active", display_name: "Demo Operator", created_at: now(), updated_at: now() };
    this.balance = Number.isFinite(seed.balance) ? seed.balance : 1250;
    this.session = null;
    this.rounds = [];
    this.results = new Map();
    this.ledger = [];
    this.history = [];
    this.idempotency = new Map();
    this.maintenance = false;
  }

  respond(data, status = 200) { return { ok: status < 400, status, server_timestamp: now(), data }; }
  ensureSession() {
    if (!this.session || this.session.expires_at <= Date.now() || this.session.status !== "active") {
      throw new NativeApiError("SESSION_EXPIRED", "Sesi native telah berakhir.", 401);
    }
  }
  ensureAvailable() {
    if (this.maintenance) throw new NativeApiError("MAINTENANCE", "Native API sedang dalam pemeliharaan.", 503);
  }
  transactionKey(input) { return String(input?.idempotency_key || input?.request_id || ""); }
  withIdempotency(input, handler) {
    const key = this.transactionKey(input);
    if (!key) throw new NativeApiError("INVALID_REQUEST", "request_id dan idempotency_key wajib diisi.", 400);
    if (this.idempotency.has(key)) return this.idempotency.get(key);
    const response = handler();
    this.idempotency.set(key, response);
    return response;
  }
  audit(event_type, reference_id, input = {}) {
    this.history.unshift({ event_id: uuid(), player_id: this.player.player_id, event_type, reference_id, created_at: now(), request_id: input.request_id || null });
  }
  createLedger(input, amount, balanceBefore, balanceAfter, status = "posted") {
    const entry = { ledger_id: uuid(), player_id: this.player.player_id, request_id: input.request_id, amount, balance_before: balanceBefore, balance_after: balanceAfter, status, created_at: now() };
    this.ledger.unshift(entry);
    return entry;
  }
  transaction(input, amount, event_type, extra = {}) {
    this.ensureSession(); this.ensureAvailable();
    return this.withIdempotency(input, () => {
      const balanceBefore = this.balance;
      const balanceAfter = balanceBefore + amount;
      if (balanceAfter < 0) throw new NativeApiError("INSUFFICIENT_BALANCE", "Saldo tidak mencukupi.", 422);
      this.balance = balanceAfter;
      const ledger = this.createLedger(input, amount, balanceBefore, balanceAfter);
      const response = this.respond({ request_id: input.request_id, idempotency_key: input.idempotency_key, session_id: this.session.session_id, player_id: this.player.player_id, server_timestamp: now(), balance_before: balanceBefore, balance_after: balanceAfter, status: "posted", ledger_reference: ledger.ledger_id, ...extra });
      this.audit(event_type, ledger.ledger_id, input);
      return response;
    });
  }

  request(method, path, input = {}) {
    const route = `${method.toUpperCase()} ${path}`;
    if (route === "GET /health") return this.respond({ status: "ok", service: "native-game", version: config.package_version });
    if (route === "GET /config") return this.respond(config);
    if (route === "POST /init") return this.respond({ game_id: config.game_id, package_version: config.package_version, runtime: "native", capabilities: config.features });
    if (route === "POST /session") {
      const session_id = uuid();
      this.session = { session_id, player_id: this.player.player_id, expires_at: Date.now() + 30 * 60 * 1000, status: "active", device_hash: "synthetic-device" };
      this.audit("session.create", session_id, input);
      return this.respond(this.session);
    }
    if (route === "POST /session/refresh") {
      this.ensureSession(); this.session.expires_at = Date.now() + 30 * 60 * 1000; this.audit("session.refresh", this.session.session_id, input); return this.respond(this.session);
    }
    if (route === "POST /session/end") {
      this.ensureSession(); this.session.status = "ended"; this.audit("session.end", this.session.session_id, input); return this.respond({ session_id: this.session.session_id, status: "ended" });
    }
    this.ensureSession();
    if (route === "GET /player") return this.respond(this.player);
    if (route === "GET /balance") return this.respond({ player_id: this.player.player_id, currency: config.currency, available_balance: this.balance, version: this.ledger.length });
    if (route === "POST /bet") {
      const bet = Number(input.bet);
      if (!Number.isInteger(bet) || bet < config.limits.min_bet || bet > config.limits.max_bet) throw new NativeApiError("BET_OUT_OF_RANGE", "Nilai bet di luar batas.", 422);
      return this.transaction(input, -bet, "bet.authorize", { bet, round_id: uuid() });
    }
    if (route === "POST /spin") {
      const bet = Number(input.bet);
      if (!Number.isInteger(bet) || bet < config.limits.min_bet || bet > config.limits.max_bet) throw new NativeApiError("BET_OUT_OF_RANGE", "Nilai bet di luar batas.", 422);
      return this.withIdempotency(input, () => {
        const round_id = uuid(); const result_id = uuid(); const balanceBefore = this.balance;
        if (balanceBefore < bet) throw new NativeApiError("INSUFFICIENT_BALANCE", "Saldo tidak mencukupi.", 422);
        const roll = (Number(input.seed) || Date.now()) % 10;
        const winAmount = roll >= 7 ? bet * (roll === 9 ? 5 : 2) : 0;
        const balanceAfter = balanceBefore - bet + winAmount;
        if (balanceAfter < 0) throw new NativeApiError("INSUFFICIENT_BALANCE", "Saldo tidak mencukupi.", 422);
        this.balance = balanceAfter;
        const ledger = this.createLedger(input, -bet + winAmount, balanceBefore, balanceAfter);
        const result = { result_id, round_id, symbols: [roll % 5, (roll + 1) % 5, (roll + 2) % 5], win_amount: winAmount, status: "posted" };
        this.results.set(result_id, result); this.rounds.unshift({ round_id, player_id: this.player.player_id, bet, result: result_id, status: "posted", created_at: now() });
        this.audit("round.spin", round_id, input);
        return this.respond({ request_id: input.request_id, idempotency_key: input.idempotency_key, session_id: this.session.session_id, player_id: this.player.player_id, server_timestamp: now(), balance_before: balanceBefore, balance_after: balanceAfter, status: "posted", ledger_reference: ledger.ledger_id, round_id, result_id, result });
      });
    }
    if (route.startsWith("GET /result/")) {
      const result = this.results.get(path.split("/").pop());
      if (!result) throw new NativeApiError("INVALID_REQUEST", "Result tidak ditemukan.", 404);
      return this.respond(result);
    }
    if (route === "GET /history") return this.respond({ events: this.history.slice(0, 50), rounds: this.rounds.slice(0, 20), ledger: this.ledger.slice(0, 20) });
    if (route === "POST /collect") return this.withIdempotency(input, () => { this.audit("collect.create", input.artifact_id || uuid(), input); return this.respond({ artifact_id: input.artifact_id || uuid(), status: "accepted", validation_id: uuid() }); });
    if (route === "POST /bonus") return this.transaction(input, Number(input.amount) > 0 ? Number(input.amount) : 25, "bonus.claim", { bonus_id: input.bonus_id || "welcome" });
    throw new NativeApiError("INVALID_REQUEST", `Endpoint tidak didukung: ${route}`, 404);
  }
}

export const nativeApi = new NativeGameApi();
export async function apiRequest(method, path, input) { return nativeApi.request(method, path, input); }
