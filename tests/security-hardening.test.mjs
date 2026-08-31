import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateHostname, parseTargetUrl } from "../src/lib/asset-proxy.js";
import { handleNativeApi } from "../src/native-api.js";

test("asset proxy rejects private, mapped, credential, and invalid IP targets", () => {
  for (const host of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "[::1]", "[::ffff:127.0.0.1]", "foo.local"]) assert.equal(isPrivateHostname(host), true, host);
  assert.equal(parseTargetUrl("https://user:pass@example.com/a").error !== undefined, true);
  assert.equal(parseTargetUrl("http://127.0.0.1/").error !== undefined, true);
  assert.equal(parseTargetUrl("https://cdn.example.com/a.png").url.hostname, "cdn.example.com");
});

test("native substitute fails closed in production mode", async () => {
  const response = await handleNativeApi(new Request("https://collector.test/api/game/health"), { NATIVE_API_MODE: "production" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error_code, "NATIVE_API_NOT_CONFIGURED");
});

test("native session validates player id and optional bootstrap key", async () => {
  const bad = await handleNativeApi(new Request("https://collector.test/api/game/session", { method: "POST", body: JSON.stringify({ player_id: "../../other" }) }), {});
  assert.equal(bad.status, 400);
  const denied = await handleNativeApi(new Request("https://collector.test/api/game/session", { method: "POST", body: "{}" }), { NATIVE_API_KEY: "test-key" });
  assert.equal(denied.status, 401);
});
