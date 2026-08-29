#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(process.argv[2] || "native-game");
const reportPath = path.resolve(process.argv[3] || path.join(root, "validation", "validation-report.json"));
const checks = [];
const exists = (relative) => fs.existsSync(path.join(root, relative));
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const add = (name, status, details, extra = {}) => checks.push({ check_name: name, status, details, ...extra });
const required = ["index.html", "shell/bootstrap.js", "shell/router.js", "shell/state-store.js", "shell/error-boundary.js", "shell/telemetry.js", "shell/accessibility.js", "shell/app.js", "api/api-contract.json", "api/error-codes.json", "api/edu-network-adapter.js", "config/native-game-config.json", "config/feature-flags.json", "config/environment.schema.json", "manifests/asset-manifest.json", "manifests/dependency-manifest.json", "legal/LICENSES.txt", "legal/OWNERSHIP.txt", "legal/NOTICE.txt", "SECURITY.txt", "CHANGELOG.txt", "NATIVE_COLLECT_SYSTEM.txt"];

for (const file of required) add(`required:${file}`, exists(file) ? "PASS" : "FAIL", exists(file) ? "file present" : "required file missing");

let config;
try {
  config = JSON.parse(read("config/native-game-config.json"));
  const valid = config.schema_version === "1.0" && config.runtime === "native" && config.asset_mode === "local" && config.telemetry?.pii === false && config.limits?.min_bet <= config.limits?.default_bet && config.limits?.default_bet <= config.limits?.max_bet && config.ownership?.permission_status === "AUTHORIZED_OWNER";
  add("config.schema", valid ? "PASS" : "FAIL", valid ? "native config satisfies release constraints" : "invalid or unsafe native config");
} catch (error) { add("config.schema", "FAIL", `config parse error: ${error.message}`); }

let contract;
try {
  contract = JSON.parse(read("api/api-contract.json"));
  const expected = ["GET /health", "GET /config", "POST /init", "POST /session", "POST /session/refresh", "POST /session/end", "GET /player", "GET /balance", "POST /bet", "POST /spin", "GET /result/{result_id}", "GET /history", "POST /collect", "POST /bonus"];
  const actual = contract.endpoints.map((item) => `${item.method} ${item.path}`);
  add("api.contract", expected.every((item) => actual.includes(item)) && contract.transaction_fields.includes("idempotency_key") ? "PASS" : "FAIL", "required native endpoints and transaction fields reviewed");
} catch (error) { add("api.contract", "FAIL", `API contract parse error: ${error.message}`); }

const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute); else files.push(absolute);
  }
}
walk(root);
const source = files.filter((file) => !file.endsWith("validation-report.json")).map((file) => fs.readFileSync(file, "utf8")).join("\n");
const forbidden = [/(?:sk-[A-Za-z0-9]{20,})/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /(?:password|secret|token)\s*[:=]\s*["'][^"']{12,}["']/i, /(?:authorization|cookie)\s*[:=]\s*["'][^"']{12,}["']/i];
const secretFinding = forbidden.find((pattern) => pattern.test(source));
add("security.secret_scan", secretFinding ? "FAIL" : "PASS", secretFinding ? "potential secret pattern found" : "no credential-like literal detected");
const traversal = files.find((file) => file.includes(".." + path.sep)) || (source.includes("../..") ? "source" : null);
add("security.path_traversal", traversal ? "FAIL" : "PASS", traversal ? "path traversal marker found" : "package paths are local and normalized");
const externalRuntime = source.match(/(?:src|href)=["']https?:\/\//i);
add("security.external_runtime", externalRuntime ? "WARN" : "PASS", externalRuntime ? "external runtime reference requires allowlist review" : "no external runtime reference in native shell");
const protectedMarkers = /(?:DRM key|decryption key|private key|active token|signed request)/i.test(source) && !/does not include|excluded|protected-resource decision/i.test(source);
add("security.protected_runtime", protectedMarkers ? "BLOCKED" : "PASS", protectedMarkers ? "protected runtime marker requires exclusion" : "protected resources excluded or documented only");

const assetManifest = JSON.parse(read("manifests/asset-manifest.json"));
const criticalMissing = assetManifest.assets.filter((asset) => asset.critical && !exists(asset.path));
add("asset.critical", criticalMissing.length ? "FAIL" : "PASS", criticalMissing.length ? `missing: ${criticalMissing.map((item) => item.path).join(", ")}` : "all critical assets are present");
const unauthorized = assetManifest.assets.filter((asset) => !["AUTHORIZED_OWNER", "AUTHORIZED_LICENSE", "AUTHORIZED_API"].includes(asset.permission_status));
add("ownership.release_scope", unauthorized.length ? "BLOCKED" : "PASS", unauthorized.length ? "release asset lacks authorized permission status" : "all release assets have authorized ownership status");

const hash = crypto.createHash("sha256");
for (const file of files.sort()) { hash.update(path.relative(root, file)); hash.update(fs.readFileSync(file)); }
const packageHash = hash.digest("hex");
add("integrity.package_hash", "PASS", `deterministic package hash ${packageHash.slice(0, 16)}…`, { sha256: packageHash });

const failed = checks.filter((item) => item.status === "FAIL" || item.status === "BLOCKED");
const report = { schema_version: "1.0", generated_at: new Date().toISOString(), package_root: root, package_version: config?.package_version || null, checks, summary: { total: checks.length, pass: checks.filter((item) => item.status === "PASS").length, warn: checks.filter((item) => item.status === "WARN").length, fail: checks.filter((item) => item.status === "FAIL").length, blocked: checks.filter((item) => item.status === "BLOCKED").length, release_gate: failed.length ? "FAIL" : "PASS" }, package_sha256: packageHash };
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ report: reportPath, ...report.summary, package_sha256: packageHash }, null, 2));
process.exitCode = failed.length ? 1 : 0;
