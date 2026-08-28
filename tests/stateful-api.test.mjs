import assert from "node:assert/strict";
import { createStatefulApiEmulator } from "../src/offline/stateful-api-emulator.js";

const emulator = createStatefulApiEmulator({ initialBalance: 1000, defaultBet: 100, seed: 123 });

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
