import fs from "node:fs";

const TOOL_PROBES = Object.freeze([
  { id: "chromium-playwright", label: "Chromium + Playwright", commands: ["chromium", "google-chrome", "chromium-browser"], packageNames: ["playwright"] },
  { id: "chrome-cdp", label: "Chrome DevTools Protocol (CDP)", commands: ["chromium", "google-chrome", "chromium-browser"], packageNames: ["playwright"] },
  { id: "wabt", label: "WABT", commands: ["wat2wasm", "wasm-objdump", "wasm2wat"], packageNames: [] },
  { id: "mitmproxy", label: "mitmproxy", commands: ["mitmproxy", "mitmdump"], packageNames: [] },
  { id: "wireshark", label: "Wireshark", commands: ["wireshark", "tshark"], packageNames: [] },
  { id: "ghidra", label: "Ghidra", commands: ["ghidra", "ghidraRun", "analyzeHeadless"], packageNames: [] }
]);

function commandExists(command, env = process.env) {
  const path = String(env.PATH || "").split(":").filter(Boolean);
  return path.some((dir) => {
    try { fs.accessSync(`${dir}/${command}`, fs.constants.X_OK); return true; }
    catch { return false; }
  });
}

export function getToolProbes() { return TOOL_PROBES.map((probe) => ({ ...probe, commands: [...probe.commands], packageNames: [...probe.packageNames] })); }

export function probeToolAvailability({ env = process.env, installedPackages = [] } = {}) {
  const packageSet = new Set(installedPackages);
  return TOOL_PROBES.map((probe) => {
    const command = probe.commands.find((candidate) => commandExists(candidate, env)) || null;
    const packageName = probe.packageNames.find((candidate) => packageSet.has(candidate)) || null;
    return {
      id: probe.id,
      label: probe.label,
      available: Boolean(command || packageName),
      command,
      packageName,
      probeOnly: true,
      policy: "availability-only; no capture, bypass, or binary execution"
    };
  });
}

export function summarizeToolAvailability(results) {
  const list = Array.isArray(results) ? results : [];
  return { total: list.length, available: list.filter((item) => item.available).length, unavailable: list.filter((item) => !item.available).length, results: list };
}
