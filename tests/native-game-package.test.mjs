import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NativeGameApi, NativeApiError } from "../native-game/api/edu-network-adapter.js";

const root = path.resolve("native-game");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const request = (api, method, route, extra = {}) => api.request(method, route, { request_id: `test-${method}-${route}`, idempotency_key: `idem-${method}-${route}`, ...extra });

test("native package contains the required shell and release records", () => {
  for (const file of ["index.html", "shell/bootstrap.js", "shell/app.js", "sw.js", "config/native-game-config.json", "api/api-contract.json", "manifests/asset-manifest.json", "legal/OWNERSHIP.txt", "SECURITY.txt"]) {
    assert.equal(fs.existsSync(path.join(root, file)), true, file);
  }
});

test("config and contract declare native runtime and complete endpoint set", () => {
  const config = readJson("config/native-game-config.json");
  const contract = readJson("api/api-contract.json");
  assert.equal(config.runtime, "native");
  assert.equal(config.telemetry.pii, false);
  assert.equal(contract.endpoints.length, 14);
  assert.equal(contract.client_authority.can_set_balance_after, false);
});

test("native transaction is server-authoritative and idempotent", () => {
  const api = new NativeGameApi({ balance: 100 });
  request(api, "POST", "/session");
  const input = { request_id: "r-1", idempotency_key: "idem-1", bet: 10, seed: 9 };
  const first = api.request("POST", "/spin", input);
  const second = api.request("POST", "/spin", input);
  assert.deepEqual(second, first);
  assert.equal(api.balance, first.data.balance_after);
  assert.equal(api.ledger.length, 1);
  assert.equal(first.data.status, "posted");
});

test("invalid bet and insufficient balance are rejected with codes", () => {
  const api = new NativeGameApi({ balance: 5 });
  request(api, "POST", "/session");
  assert.throws(() => api.request("POST", "/spin", { request_id: "r-a", idempotency_key: "i-a", bet: 0 }), (error) => error instanceof NativeApiError && error.error_code === "BET_OUT_OF_RANGE");
  assert.throws(() => api.request("POST", "/spin", { request_id: "r-b", idempotency_key: "i-b", bet: 10 }), (error) => error instanceof NativeApiError && error.error_code === "INSUFFICIENT_BALANCE");
});
