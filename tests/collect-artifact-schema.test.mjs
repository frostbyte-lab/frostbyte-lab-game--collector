import assert from "node:assert/strict";
import { buildApiMap } from "../src/package/api-map.js";
import { validatePackageFiles } from "../src/offline/package-readiness.js";

const resources = [
  {
    url: "https://game.example.test/api/init",
    type: "xhr",
    status: 200,
    localPath: "assets/data/0001-init.json",
    size: 42,
    category: "api",
    apiKind: "init",
    apiContract: {
      order: 1,
      method: "POST",
      url: "https://game.example.test/api/init",
      path: "/api/init",
      kind: "init",
      requestBody: "{\"gameId\":\"demo\"}",
      response: { status: 200, contentType: "application/json", localPath: "assets/data/0001-init.json", schema: { ok: "boolean", data: "object" } }
    }
  },
  {
    url: "https://game.example.test/api/spin",
    type: "fetch",
    status: 200,
    localPath: "assets/data/0002-spin.json",
    size: 56,
    category: "api",
    apiKind: "spin",
    apiContract: {
      order: 2,
      method: "POST",
      url: "https://game.example.test/api/spin",
      path: "/api/spin",
      kind: "spin",
      requestBody: "{\"bet\":100}",
      response: { status: 200, contentType: "application/json", localPath: "assets/data/0002-spin.json", schema: { ok: "boolean", data: "object" } }
    }
  }
];

const zipFiles = {
  "index.html": new TextEncoder().encode("<script src=\\\"assets/js/game.js\\\"></script>"),
  "assets/js/game.js": new TextEncoder().encode("fetch('/api/init'); fetch('/api/spin'); new WebSocket('/events')"),
  "assets/data/0001-init.json": new TextEncoder().encode('{"ok":true,"data":{"balance":100000}}'),
  "assets/data/0002-spin.json": new TextEncoder().encode('{"ok":true,"data":{"winAmount":0}}'),
  "offline-super.json": new TextEncoder().encode('{"status":"READY"}'),
  "realtime.json": new TextEncoder().encode('{"version":1,"sessions":[]}'),
  "KETERANGAN.md": new TextEncoder().encode('Offline package evidence'),
  "analisis.json": new TextEncoder().encode('{"ok":true}'),
  "README.md": new TextEncoder().encode('# Offline package')
};
const apiMap = buildApiMap(resources, zipFiles);
zipFiles["api-map.json"] = new TextEncoder().encode(JSON.stringify(apiMap));
zipFiles["manifest.json"] = new TextEncoder().encode(JSON.stringify({ resources: resources.map((item) => ({ ...item, collectStatus: "VERIFIED" })) }));
zipFiles["runtime-interceptor.js"] = new TextEncoder().encode("export function install() {}\n");
zipFiles["realtime-adapter.js"] = new TextEncoder().encode("export class OfflineWebSocket {}\n");

const report = validatePackageFiles(zipFiles, {
  browserTest: { status: "FULL_OFFLINE_READY", networkIsolated: true, gameplayReady: true, failures: [] }
});
assert.equal(apiMap.endpoints.length, 2);
assert.equal(apiMap.replaySequence.length, 2);
assert.equal(report.api.endpoints, 2);
assert.equal(report.api.snapshots, 2);
assert.equal(report.assets.unresolved, 0);
assert.equal(report.status, "FULL_OFFLINE_READY");
console.log("collect artifact schema test passed");
