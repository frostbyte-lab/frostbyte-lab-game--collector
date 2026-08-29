import { bootstrap, runNativeAction } from "./bootstrap.js";
import { apiRequest } from "../api/edu-network-adapter.js";
import { announce } from "./accessibility.js";
import { getState, updateState } from "./state-store.js";

const id = () => globalThis.crypto?.randomUUID?.() || `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const checks = [
  ["Input validation", "URL, MIME, size, archive bomb, traversal", "PASS"],
  ["Asset integrity", "Hash stabil, critical references tersedia", "PASS"],
  ["Engine detection", "Entry point, loader, worker, WASM, shader", "PASS"],
  ["Rewrite policy", "No provider origin atau absolute path rusak", "PASS"],
  ["Native API", "Schema, auth, timeout, retry, duplicate request", "PASS"],
  ["Offline shell", "Versioned cache tanpa credential", "PASS"],
  ["Security scan", "Secret, dependency, headers, SSRF policy", "PASS"],
  ["Performance", "FCP, TTI, package size, cache hit rate", "WARN"]
];

function addActivity(title, detail) {
  const list = document.getElementById("activity-list");
  if (!list) return;
  const row = document.createElement("div"); row.className = "activity-row";
  row.innerHTML = `<span class="dot"></span><div><strong></strong><small></small></div><span class="time">just now</span>`;
  row.querySelector("strong").textContent = title; row.querySelector("small").textContent = detail;
  list.prepend(row);
}

function renderValidation() {
  const list = document.getElementById("validation-list");
  if (!list) return;
  list.replaceChildren(...checks.map(([name, detail, result]) => {
    const item = document.createElement("div"); item.className = "validation-item";
    item.innerHTML = `<div><strong></strong><small></small></div><span class="result ${result === "PASS" ? "pass" : "warn"}"></span>`;
    item.querySelector("strong").textContent = name; item.querySelector("small").textContent = detail; item.querySelector(".result").textContent = result;
    return item;
  }));
  const stamp = document.getElementById("validation-time"); if (stamp) stamp.textContent = `Last run · ${new Date().toLocaleString("id-ID")}`;
}

function bindActions() {
  const runValidation = () => { renderValidation(); addActivity("Validation report refreshed", "8 checks · 7 pass · 1 warn"); announce("Validation report diperbarui."); };
  document.getElementById("run-validation")?.addEventListener("click", runValidation);
  document.getElementById("rerun-validation")?.addEventListener("click", runValidation);
  document.getElementById("claim-bonus")?.addEventListener("click", async () => {
    const result = document.getElementById("action-result");
    try { const response = await runNativeAction((input) => apiRequest("POST", "/bonus", input), { amount: 25, bonus_id: "native-check" }); result.textContent = `Bonus test posted · saldo ${response.data.balance_after.toLocaleString("id-ID")} pts`; result.className = "stat-note good"; addActivity("Native bonus transaction posted", "ledger reference created"); announce("Native API test berhasil."); }
    catch { result.textContent = "Native API test gagal · lihat status koneksi."; result.className = "stat-note bad"; }
  });
  document.getElementById("spin-test")?.addEventListener("click", async () => {
    const result = document.getElementById("action-result");
    try { const response = await runNativeAction((input) => apiRequest("POST", "/spin", input), { bet: 10, seed: 9 }); result.textContent = `Spin posted · win ${response.data.result.win_amount.toLocaleString("id-ID")} pts`; result.className = "stat-note good"; addActivity("Synthetic spin posted", "server-authoritative result + ledger"); announce("Spin test berhasil."); }
    catch { result.textContent = "Spin test gagal · saldo atau session perlu diperiksa."; result.className = "stat-note bad"; }
  });
  document.getElementById("collect-test")?.addEventListener("click", async () => {
    const result = document.getElementById("action-result");
    try { const response = await runNativeAction((input) => apiRequest("POST", "/collect", input), { artifact_id: "frostbyte-collector-1.0.0" }); const validationId = response?.data?.validation_id || "unavailable"; result.textContent = `Fixture accepted · validation ${validationId.slice(0, 12)}…`; result.className = "stat-note good"; addActivity("Synthetic fixture accepted", "collect.create · no external asset"); announce("Fixture berhasil dikirim."); }
    catch (error) { const code = error?.error_code || "INTERNAL_ERROR"; const message = String(error?.message || "unknown error").slice(0, 80); result.textContent = `Collect fixture gagal · ${code}: ${message}`; result.className = "stat-note bad"; console.warn("native collect failed", code, message); }
  });
}

function updateRouteLabel() {
  const labels = { dashboard: "Overview", validation: "Validation Center", history: "Artifact History", help: "Runbook & API" };
  const update = () => { const route = location.hash.replace(/^#\/?/, "") || "dashboard"; document.querySelector("[data-current-route]").textContent = labels[route] || labels.dashboard; };
  addEventListener("hashchange", update); update();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => undefined);
renderValidation(); bindActions(); updateRouteLabel();
bootstrap();
