import assert from "node:assert/strict";
import { createStatefulApiEmulator } from "../src/offline/stateful-api-emulator.js";
import { buildApiContract } from "../src/collect/api-contract.js";
import { createLocalApiRouter } from "../src/offline/api-router.js";
import { createMemoryStorage } from "../src/offline/state-storage.js";

const contract = buildApiContract({
  url: "https://game.example.test/custom/start",
  method: "POST",
  requestHeaders: { Authorization: "secret", "Content-Type": "application/json" },
  requestBody: JSON.stringify({ gameId: "g-test", bet: 100 }),
  status: 200,
  responseHeaders: { "content-type": "application/json" },
  responseBody: JSON.stringify({ ok: true, balance: 1000, data: { ready: true } }),
  kind: "init",
  confidence: "high"
});
assert.equal(contract.method, "POST");
assert.equal(contract.target.path, "/custom/start");
assert.equal(contract.request.headers.authorization, "<redacted>");
assert.deepEqual(contract.request.body, { gameId: "g-test", bet: 100 });
assert.deepEqual(contract.response.topKeys, ["ok", "balance", "data"]);

const sequenceCheck = createStatefulApiEmulator({ autoPersist: false });
const prematureSpin = await sequenceCheck.handle("https://gc.offline.local/spin", { method: "POST", body: JSON.stringify({ bet: 100 }) });
assert.equal(prematureSpin.status, 409);
assert.equal((await prematureSpin.json()).error, "INVALID_STATE");

const storage = createMemoryStorage();
const emulator = createStatefulApiEmulator({ initialBalance: 1000, defaultBet: 100, seed: 123, playerId: "p-test", gameId: "g-test", apiContract: contract, storage, storageKey: "test-session" });
const session = await emulator.handle("https://gc.offline.local/verifysession");
const sessionPayload = await session.json();
assert.equal(sessionPayload.sessionId, emulator.snapshot().sessionId);
assert.equal(sessionPayload.token, emulator.snapshot().token);
assert.equal(sessionPayload.playerId, "p-test");
assert.equal(sessionPayload.gameId, "g-test");
const customInit = await emulator.handle("https://game.example.test/custom/start");
assert.equal(customInit.status, 200);
assert.equal((await customInit.json()).balance, 1000);
const customMap = { endpoints: [{ pathLower: "/provider/v3/init", kind: "init", status: 200, hasSnapshot: false, mockTemplate: {} }] };
const router = createLocalApiRouter({ emulator, apiMap: customMap, mode: "offline" });
const routed = await router.handle("https://provider.example.test/provider/v3/init");
assert.equal(routed.status, 200);
assert.equal((await routed.json()).balance, 1000);
const unknown = await router.handle("https://provider.example.test/provider/v3/unknown");
assert.equal(unknown.status, 503);
assert.equal((await unknown.json()).error, "UNKNOWN_API_ROUTE");

const init = await emulator.handle("https://gc.offline.local/gameinfo");
assert.equal(init.status, 200);
assert.equal((await init.json()).balance, 1000);

const balanceBefore = await emulator.handle("https://gc.offline.local/gamewallet");
assert.equal((await balanceBefore.json()).balance, 1000);

const spin = await emulator.handle("https://gc.offline.local/spin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ bet: 100 })
});
assert.equal(spin.status, 200);
const spinPayload = await spin.json();
assert.equal(spinPayload.ok, true);
assert.equal(spinPayload.data.bet, 100);
assert.equal(spinPayload.data.roundId.endsWith("-1"), true);
assert.equal(typeof spinPayload.data.payoutMultiplier, "number");
assert.equal(["WIN", "LOSS"].includes(spinPayload.data.outcome), true);
assert.equal(spinPayload.data.balance, spinPayload.data.balanceBefore - spinPayload.data.charged + spinPayload.data.winAmount);
assert.equal(emulator.snapshot().round, 1);
assert.equal(emulator.snapshot().history.length, 1);
const result = await emulator.handle("https://gc.offline.local/result");
assert.equal(result.status, 200);
assert.equal((await result.json()).data.roundId, spinPayload.data.roundId);
const saved = emulator.snapshot();
emulator.reset({ initialBalance: 500 });
assert.equal(emulator.snapshot().balance, 500);
assert.equal(emulator.snapshot().round, 0);
emulator.restore(saved);
assert.equal(emulator.snapshot().balance, saved.balance);
assert.equal(emulator.snapshot().round, saved.round);
assert.equal(emulator.snapshot().sessionId, saved.sessionId);
emulator.persist();
const resumed = createStatefulApiEmulator({ initialBalance: 1000, defaultBet: 100, seed: 999, storage, storageKey: "test-session" });
const loaded = resumed.loadPersisted();
assert.equal(loaded.balance, saved.balance);
assert.equal(loaded.round, saved.round);
assert.equal(loaded.sessionId, saved.sessionId);
assert.equal(loaded.token, "gc-offline-token");
const replay = createStatefulApiEmulator({ initialBalance: 1000, defaultBet: 100, seed: 123, autoPersist: false });
await replay.handle("https://gc.offline.local/verifysession");
await replay.handle("https://gc.offline.local/gameinfo");
const firstReplay = await replay.handle("https://gc.offline.local/spin", { method: "POST", body: JSON.stringify({ bet: 100 }) });
const firstReplayBody = await firstReplay.json();
replay.replay();
await replay.handle("https://gc.offline.local/verifysession");
await replay.handle("https://gc.offline.local/gameinfo");
const secondReplay = await replay.handle("https://gc.offline.local/spin", { method: "POST", body: JSON.stringify({ bet: 100 }) });
const secondReplayBody = await secondReplay.json();
assert.deepEqual(secondReplayBody.data.symbols, firstReplayBody.data.symbols);
assert.equal(secondReplayBody.data.winAmount, firstReplayBody.data.winAmount);

const invalid = await emulator.handle("https://gc.offline.local/spin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ bet: 0 })
});
assert.equal(invalid.status, 400);

const payoutEmulator = createStatefulApiEmulator({ initialBalance: 1000, defaultBet: 100, seed: 123, payoutTable: { 3: 10, 2: 0 } });
await payoutEmulator.handle("https://gc.offline.local/verifysession");
await payoutEmulator.handle("https://gc.offline.local/gameinfo");
const payoutSpin = await payoutEmulator.handle("https://gc.offline.local/spin", { method: "POST", body: JSON.stringify({ bet: 100 }) });
const payoutPayload = await payoutSpin.json();
assert.equal(payoutPayload.data.balance, payoutPayload.data.balanceBefore - 100 + payoutPayload.data.winAmount);
assert.equal(payoutPayload.data.winAmount, payoutPayload.data.bet * payoutPayload.data.payoutMultiplier);

const freeEmulator = createStatefulApiEmulator({ initialBalance: 1000, defaultBet: 100, autoPersist: false });
await freeEmulator.handle("https://gc.offline.local/verifysession");
await freeEmulator.handle("https://gc.offline.local/gameinfo");
freeEmulator.state.freeSpins = 1;
const freeSpin = await freeEmulator.handle("https://gc.offline.local/spin", { method: "POST", body: JSON.stringify({ bet: 100 }) });
const freeSpinPayload = await freeSpin.json();
assert.equal(freeSpinPayload.data.freeSpin, true);
assert.equal(freeSpinPayload.data.charged, 0);

const insufficient = await emulator.handle("https://gc.offline.local/spin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ bet: 10000 })
});
assert.equal(insufficient.status, 409);

console.log("stateful API emulator test passed");
