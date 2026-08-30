import test from "node:test";
import assert from "node:assert/strict";
import { getToolProbes, probeToolAvailability, summarizeToolAvailability } from "../src/tools/tool-availability.js";

test("tool availability probes cover external and partial tool families", () => {
  const probes = getToolProbes();
  assert.equal(probes.length, 6);
  assert.deepEqual(probes.map((probe) => probe.id), ["chromium-playwright", "chrome-cdp", "wabt", "mitmproxy", "wireshark", "ghidra"]);
});

test("availability probe is passive and deterministic for supplied environment", () => {
  const results = probeToolAvailability({ env: { PATH: "/does-not-exist" }, installedPackages: [] });
  assert.equal(results.length, 6);
  assert.equal(results.every((item) => item.available === false), true);
  assert.equal(results.every((item) => item.probeOnly === true), true);
  assert.equal(results.every((item) => item.policy.includes("no capture")), true);
  assert.deepEqual(summarizeToolAvailability(results), { total: 6, available: 0, unavailable: 6, results });
});
