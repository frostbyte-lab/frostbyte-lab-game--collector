#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const probes = [
  ["chromium-playwright", ["chromium", "google-chrome", "chromium-browser"]],
  ["chrome-cdp", ["chromium", "google-chrome", "chromium-browser"]],
  ["wabt", ["wat2wasm", "wasm-objdump", "wasm2wat"]],
  ["mitmproxy", ["mitmproxy", "mitmdump"]],
  ["wireshark", ["wireshark", "tshark"]],
  ["ghidra", ["ghidra", "ghidraRun", "analyzeHeadless"]]
];
function which(command) {
  try { return execFileSync("which", [command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; }
  catch { return null; }
}
const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
const installed = new Set(Object.keys({ ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) }));
const results = probes.map(([id, commands]) => {
  const command = commands.map(which).find(Boolean) || null;
  const packageName = id.includes("playwright") || id === "chrome-cdp" ? (installed.has("playwright") ? "playwright" : null) : null;
  return { id, available: Boolean(command || packageName), command, packageName, probeOnly: true, policy: "availability-only; no capture, bypass, or binary execution" };
});
const report = { version: 1, generatedAt: new Date().toISOString(), summary: { total: results.length, available: results.filter((x) => x.available).length, unavailable: results.filter((x) => !x.available).length }, results };
const output = process.argv[2] || "audit/master-toolset-availability.json";
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
