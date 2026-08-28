import assert from "node:assert/strict";
import { createStatefulApiEmulator } from "../src/offline/stateful-api-emulator.js";
import { createLocalApiRouter } from "../src/offline/api-router.js";
import { buildApiContract } from "../src/collect/api-contract.js";

const contract = buildApiContract({
  url: "https://provider.example.test/provider/v3/spin",
  method: "POST",
  requestHeaders: { "Content-Type": "application/json" },
  requestBody: JSON.stringify({ bet: 100 }),
  status: 200,
  responseHeaders: { "content-type": "application/json" },
  responseBody: JSON.stringify({ ok: true, balance: 1234, winAmount: 50 }),
  kind: "spin",
  confidence: "high"
});
const apiMap = {
  endpoints: [{
    pathLower: "/provider/v3/spin",
    kind: "spin",
    status: 200,
    hasSnapshot: true,
    snapshot: { ok: true, balance: 1234, winAmount: 50 },
    contract
  }]
};
const router = createLocalApiRouter({
  emulator: createStatefulApiEmulator({ autoPersist: false }),
  apiMap,
  mode: "offline",
  replay: true
});
const replay = await router.handle("https://provider.example.test/provider/v3/spin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ bet: 100 })
});
assert.equal(replay.status, 200);
assert.equal(replay.headers.get("X-GC-Replay"), "snapshot");
assert.deepEqual(await replay.json(), apiMap.endpoints[0].snapshot);

const mismatch = await router.handle("https://provider.example.test/provider/v3/spin");
assert.equal(mismatch.status, 503);
assert.equal((await mismatch.json()).error, "API_CONTRACT_MISMATCH");
console.log("API replay fixture test passed");
