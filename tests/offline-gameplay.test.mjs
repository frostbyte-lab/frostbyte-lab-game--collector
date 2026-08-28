import assert from "node:assert/strict";
import { createStatefulApiEmulator } from "../src/offline/stateful-api-emulator.js";
import { validateOfflineGameplay, assertOfflineReady } from "../src/offline/offline-validation.js";

const emulator = createStatefulApiEmulator({
  initialBalance: 1000,
  defaultBet: 100,
  seed: 42,
  autoPersist: false
});
const report = await validateOfflineGameplay({ emulator, bet: 100 });
assertOfflineReady(report);
assert.equal(report.status, "FULL_OFFLINE_READY");
assert.equal(report.networkIsolated, true);
assert.equal(report.networkAttempts, 0);
assert.deepEqual(report.failures, []);
assert.equal(report.steps.length, 5);
assert.equal(report.steps[3].name, "spin");
assert.equal(report.state.round, 1);
assert.equal(report.state.history, 1);
console.log("offline gameplay validation test passed");
