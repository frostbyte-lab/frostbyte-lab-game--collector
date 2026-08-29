import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { validatePackageFiles, validateZipPackage } from "../src/offline/package-readiness.js";

const files = {
  "index.html": strToU8("<html><script src='game.js'></script></html>"),
  "game.js": strToU8("fetch('/spin'); new WebSocket('wss://provider.example.test/events')"),
  "manifest.json": strToU8(JSON.stringify([{ url: "https://cdn.example.test/game.js", localPath: "game.js", collectStatus: "DOWNLOADED" }])),
  "api-map.json": strToU8(JSON.stringify({ endpoints: [
    { pathLower: "/init", kind: "init", hasSnapshot: true, snapshot: { ok: true } },
    { pathLower: "/balance", kind: "balance", hasSnapshot: true, snapshot: { balance: 100 } },
    { pathLower: "/spin", kind: "spin", hasSnapshot: true, snapshot: { winAmount: 0 } }
  ], replaySequence: [{ order: 1 }, { order: 2 }, { order: 3 }] })),
  "offline-super.json": strToU8(JSON.stringify({ status: "READY" })),
  "KETERANGAN.md": strToU8("Authorized offline package evidence"),
  "analisis.json": strToU8(JSON.stringify({ ok: true })),
  "src/offline/realtime-adapter.js": strToU8("export class OfflineWebSocket {}")
};
const report = validatePackageFiles(files, {
  browserTest: { status: "FULL_OFFLINE_READY", gameplayReady: true, networkIsolated: true, failures: [] }
});
assert.equal(report.status, "FULL_OFFLINE_READY");
assert.equal(report.api.snapshots, 3);
assert.equal(report.api.replaySequence, 3);
assert.equal(report.realtime.detected, true);
assert.deepEqual(report.blockers, []);

const zip = zipSync(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes])));
const zipReport = validateZipPackage(zip, {
  browserTest: { status: "FULL_OFFLINE_READY", gameplayReady: true, networkIsolated: true, failures: [] }
});
assert.equal(zipReport.fullOfflineReady, true);

const incomplete = validatePackageFiles({ "index.html": strToU8("<script src='game.js'></script>"), "game.js": strToU8("fetch('https://api.example.test/spin')") });
assert.equal(incomplete.status, "HYBRID_READY");
assert.equal(incomplete.fullOfflineReady, false);
assert.equal(incomplete.blockers.includes("Browser gameplay test belum berhasil"), true);
console.log("package readiness test passed");
