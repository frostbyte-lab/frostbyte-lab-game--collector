#!/usr/bin/env node
const base = (process.env.SECURITY_SMOKE_BASE || "https://game-resource-collector.technologiesfrostbyte.workers.dev").replace(/\/$/, "");
const failures = [];
async function check(path, options = {}, predicate = () => true) {
  const response = await fetch(`${base}${path}`, { redirect: "manual", ...options });
  const body = await response.text();
  if (!predicate(response, body)) failures.push({ path, status: response.status, reason: "assertion failed", sample: body.slice(0, 160) });
  return { path, status: response.status, contentType: response.headers.get("content-type"), headers: Object.fromEntries(["content-security-policy", "strict-transport-security", "x-content-type-options", "referrer-policy", "permissions-policy", "access-control-allow-origin"].map((key) => [key, response.headers.get(key)])) };
}
(async () => {
  const results = [];
  results.push(await check("/api/health", {}, (r, b) => r.status === 200 && JSON.parse(b).ok === true));
  results.push(await check("/api/tools/master", {}, (r, b) => r.status === 200 && JSON.parse(b).report?.totalRequested === 50));
  results.push(await check("/api/health", { method: "OPTIONS", headers: { Origin: base } }, (r) => r.status === 204 && r.headers.get("access-control-allow-origin") === base));
  results.push(await check("/api/health", { method: "OPTIONS", headers: { Origin: "https://security-smoke.invalid" } }, (r) => r.status === 403));
  for (const path of ["/package.json", "/.env", "/wrangler.jsonc", "/.git/config"]) results.push(await check(path, {}, (r) => r.status === 404));
  const health = results.find((x) => x.path === "/api/health");
  for (const header of ["strict-transport-security", "x-content-type-options", "referrer-policy", "permissions-policy"]) if (!health.headers[header]) failures.push({ path: "/api/health", reason: `missing ${header}` });
  const report = { version: 1, base, generatedAt: new Date().toISOString(), passed: failures.length === 0, failures, results };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
})();
