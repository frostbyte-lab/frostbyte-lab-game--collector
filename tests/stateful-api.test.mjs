import assert from "node:assert/strict";
import { createStatefulApiEmulator } from "../src/offline/stateful-api-emulator.js";
import { buildApiContract } from "../src/collect/api-contract.js";

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

const emulator = createStatefulApiEmulator({ initialBalance: 1000, defaultBet: 100, seed: 123, playerId: "p-test", gameId: "g-test", apiContract: contract });
const session = await emulator.handle("https://gc.offline.local/verifysession");
const sessionPayload = await session.json();
assert.equal(sessionPayload.sessionId, emulator.snapshot().sessionId);
assert.equal(sessionPayload.token, emulator.snapshot().token);
assert.equal(sessionPayload.playerId, "p-test");
assert.equal(sessionPayload.gameId, "g-test");
const customInit = await emulator.handle("https://game.example.test/custom/start");
assert.equal(customInit.status, 200);
assert.equal((await customInit.json()).balance, 1000);

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
assert.equal(emulator.snapshot().round, 1);
assert.equal(emulator.snapshot().history.length, 1);
const saved = emulator.snapshot();
emulator.reset({ initialBalance: 500 });
assert.equal(emulator.snapshot().balance, 500);
assert.equal(emulator.snapshot().round, 0);
emulator.restore(saved);
assert.equal(emulator.snapshot().balance, saved.balance);
assert.equal(emulator.snapshot().round, saved.round);
assert.equal(emulator.snapshot().sessionId, saved.sessionId);

const invalid = await emulator.handle("https://gc.offline.local/spin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ bet: 0 })
});
assert.equal(invalid.status, 400);

const insufficient = await emulator.handle("https://gc.offline.local/spin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ bet: 10000 })
});
assert.equal(insufficient.status, 409);

console.log("stateful API emulator test passed");
