import assert from "node:assert/strict";
import { createRuntimeDependencyInterceptor } from "../src/offline/runtime-interceptor.js";

const interceptor = createRuntimeDependencyInterceptor({ mode: "offline" });
interceptor.install();
try {
  const blocked = await fetch("https://provider.example.test/api/spin", { method: "POST" });
  assert.equal(blocked.status, 503);
  assert.equal((await blocked.json()).error, "RUNTIME_NETWORK_BLOCKED");
  interceptor.trackImport("https://provider.example.test/game/module.js");
  const records = interceptor.snapshot();
  assert.equal(records.some((record) => record.kind === "fetch" && record.phase === "request"), true);
  assert.equal(records.some((record) => record.kind === "dynamic-import"), true);
  assert.equal(records.every((record) => record.url.startsWith("https://")), true);
} finally {
  interceptor.restore();
}
console.log("runtime interceptor test passed");
