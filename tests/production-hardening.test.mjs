import test from "node:test";
import assert from "node:assert/strict";
import { addCapabilityScopes, checkRateLimit, preflightResponse, withSecurityHeaders } from "../src/security/response-hardening.js";

const env = { CORS_ORIGIN: "https://game-resource-collector.technologiesfrostbyte.workers.dev" };

test("security headers are added to API responses", async () => {
  const request = new Request("https://game-resource-collector.technologiesfrostbyte.workers.dev/api/health");
  const response = withSecurityHeaders(Response.json({ ok: true }), request, env);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");
  assert.equal(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(response.headers.get("Permissions-Policy"), "camera=(), microphone=(), geolocation=(), payment=()");
});

test("preflight allows only configured origin", async () => {
  const allowed = new Request("https://game-resource-collector.technologiesfrostbyte.workers.dev/api/health", { method: "OPTIONS", headers: { Origin: env.CORS_ORIGIN } });
  const response = preflightResponse(allowed, env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), env.CORS_ORIGIN);
  const denied = preflightResponse(new Request(allowed.url, { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env);
  assert.equal(denied.status, 403);
});

test("capability report declares execution scope", () => {
  const report = addCapabilityScopes({ tools: [{ id: "x", status: "active" }, { id: "y", status: "partial" }, { id: "z", status: "external" }] });
  assert.deepEqual(report.tools.map((tool) => tool.executionScope), ["worker", "worker-or-lab", "lab-local"]);
  assert.equal(report.scopeModel.labLocal.includes("Ghidra"), true);
});

test("rate limit returns 429 after configured threshold", async () => {
  const request = () => new Request("https://game-resource-collector.technologiesfrostbyte.workers.dev/api/test-rate", { headers: { "CF-Connecting-IP": "198.51.100.44" } });
  let limited = null;
  for (let i = 0; i < 61; i += 1) limited = checkRateLimit(request(), env, { limit: 60, windowMs: 60_000 });
  assert.equal(limited?.status, 429);
  assert.equal(limited?.headers.get("Retry-After") !== null, true);
});
