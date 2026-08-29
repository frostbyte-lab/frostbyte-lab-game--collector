import test from "node:test";
import assert from "node:assert/strict";
import { classifyCaptureResource, detectProtectedResource, filterReleaseResources, sanitizeProtectedText } from "../src/security/protected-resource.js";

test("DRM and license endpoints are detected and blocked", () => {
  const result = detectProtectedResource("requestMediaKeySystemAccess('com.widevine.alpha')", { url: "https://provider.example/license" });
  assert.equal(result.blocked, true);
  assert.deepEqual(result.protected_types.sort(), ["DRM"]);
  assert.equal(result.permission_status, "BLOCKED");
});

test("credential-like values are redacted without attempting access-control bypass", () => {
  const result = sanitizeProtectedText("Authorization: Bearer abcdefghijklmnop\nclient_secret=super-secret-value");
  assert.equal(result.redacted, true);
  assert.equal(result.value.includes("abcdefghijklmnop"), false);
  assert.equal(result.value.includes("super-secret-value"), false);
});

test("authorized local resources can be released while unknown or protected resources cannot", () => {
  const result = filterReleaseResources([
    { path: "assets/icon.png", content: "local-art", permission_status: "AUTHORIZED_OWNER" },
    { path: "assets/locked.wasm", content: "protected binary", permission_status: "AUTHORIZED_OWNER" },
    { path: "server/unknown.json", content: "snapshot", permission_status: "UNKNOWN" }
  ]);
  assert.equal(result.allowed.length, 1);
  assert.equal(result.blocked.length, 2);
  assert.equal(classifyCaptureResource({ path: "assets/locked.wasm", content: "widevine license" }).permission_status, "BLOCKED");
});
