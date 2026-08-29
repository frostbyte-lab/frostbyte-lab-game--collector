import { unzipSync } from "fflate";

const TEXT_EXT = /\.(html?|js|css|json|txt|map|xml|svg)$/i;
const EXTERNAL_URL = /https?:\/\/(?!localhost|127\.0\.0\.1|[^/]*\.offline\.local)[^\s"'<>]+/gi;
const API_MARKER = /(?:fetch\s*\(|XMLHttpRequest|\/verifysession|\/gamewallet|\/gameinfo|\/spin|\/api\/)/i;
const REALTIME_MARKER = /(?:WebSocket|EventSource|new\s+WebSocket|setInterval\s*\(|\/sse|wss?:\/\/)/i;

function textOf(value) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return "";
}

function jsonFile(files, name) {
  const key = Object.keys(files).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  if (!key) return null;
  try { return JSON.parse(textOf(files[key])); } catch (_) { return null; }
}

function listExternalRefs(files) {
  const refs = [];
  for (const [path, raw] of Object.entries(files)) {
    if (!TEXT_EXT.test(path)) continue;
    const text = textOf(raw).slice(0, 500000);
    for (const url of text.match(EXTERNAL_URL) || []) refs.push({ path, url: url.slice(0, 500) });
  }
  return refs.slice(0, 200);
}

export function validatePackageFiles(files = {}, { browserTest = null } = {}) {
  const names = Object.keys(files).filter((name) => !name.endsWith("/"));
  const lowerNames = names.map((name) => name.toLowerCase());
  const manifestRaw = jsonFile(files, "manifest.json");
  const manifest = Array.isArray(manifestRaw) ? manifestRaw : (Array.isArray(manifestRaw?.resources) ? manifestRaw.resources : []);
  const apiMap = jsonFile(files, "api-map.json");
  const superReport = jsonFile(files, "offline-super.json");
  const statusReport = jsonFile(files, "collect-status.json");
  const replicationReport = jsonFile(files, "replication-report.json");
  const authorizedResearch = jsonFile(files, "authorized-research.json");
  const indexHtml = lowerNames.some((name) => /(^|\/)index\.html?$/.test(name));
  const texts = names.filter((name) => TEXT_EXT.test(name)).map((name) => textOf(files[name]).slice(0, 500000));
  const externalRefs = listExternalRefs(files);
  const apiEndpoints = Array.isArray(apiMap?.endpoints) ? apiMap.endpoints : (Array.isArray(apiMap?.contracts) ? apiMap.contracts : []);
  const snapshots = apiEndpoints.filter((entry) => entry?.hasSnapshot && entry?.snapshot || entry?.response?.localPath || entry?.response?.schema);
  const unresolved = Array.isArray(manifest) ? manifest.filter((entry) => /https?:\/\//i.test(String(entry?.url || "")) && !entry?.localPath).length : 0;
  const failed = Array.isArray(manifest) ? manifest.filter((entry) => /FAILED|INVALID|ERROR/i.test(String(entry?.collectStatus || entry?.strictStatus || ""))).length : 0;
  const hasApi = apiEndpoints.length > 0 || texts.some((text) => API_MARKER.test(text));
  const hasRealtime = texts.some((text) => REALTIME_MARKER.test(text)) || Boolean(replicationReport?.realtime?.sessions);
  // Sandbox aplikasi menginjeksi adapter; realtime.json adalah bukti bahwa data replay tersedia.
  const hasRuntimeInterceptor = lowerNames.some((name) => /runtime-interceptor|realtime-adapter|offline-validation/.test(name)) || lowerNames.some((name) => /(^|\/)realtime\.json$/.test(name));
  const criticalReplicationBlockers = Array.isArray(replicationReport?.blockers) ? replicationReport.blockers.filter((item) => item?.severity === "critical") : [];
  const browser = browserTest || { status: "NOT_RUN", networkIsolated: false, gameplayReady: false, failures: ["Browser test belum dijalankan"] };
  const shellReady = indexHtml && names.some((name) => /\.js$/i.test(name));
  const hybridReady = shellReady && (externalRefs.length > 0 || unresolved > 0 || hasApi);
  const mockReady = shellReady && apiEndpoints.length > 0 && (snapshots.length > 0 || Boolean(superReport));
  const gameplayReady = Boolean(browser.gameplayReady) || (mockReady && snapshots.length >= 3 && failed === 0);
  const evidence = {
    manifest: Boolean(manifestRaw),
    apiMap: !hasApi || Boolean(apiMap),
    offlineSuper: Boolean(superReport),
    explanation: lowerNames.some((name) => /(^|\/)(keterangan|offline_readme|offline-audit|audit-offline|readme)\.(json|md|txt)$/i.test(name)),
    analysis: Boolean(jsonFile(files, "analisis.json")) || lowerNames.some((name) => /(^|\/)analysis\//.test(name)),
    browserProof: Boolean(browser.gameplayReady && browser.networkIsolated && browser.status === "FULL_OFFLINE_READY")
  };
  const strictBlockers = [];
  for (const [name, ok] of Object.entries(evidence)) if (!ok) strictBlockers.push(`Evidence ${name} belum lengkap.`);
  if (unresolved > 0) strictBlockers.push(`${unresolved} asset eksternal belum direwrite.`);
  if (failed > 0) strictBlockers.push(`${failed} asset gagal dikoleksi.`);
  if (hasApi && (!apiEndpoints.length || !snapshots.length || !Array.isArray(apiMap?.replaySequence) || apiMap.replaySequence.length === 0)) strictBlockers.push("Kontrak API/snapshot/replay belum lengkap.");
  if (hasRealtime && (!hasRuntimeInterceptor || !Array.isArray(apiMap?.replaySequence) || apiMap.replaySequence.length === 0)) strictBlockers.push("Bukti realtime adapter/replay belum lengkap.");
  if (criticalReplicationBlockers.length) strictBlockers.push(...criticalReplicationBlockers.map((item) => item.message || `Blocker kritis: ${item.kind || "unknown"}`));
  const strictGate = { ready: strictBlockers.length === 0, blockers: strictBlockers, evidence };
  const fullOfflineReady = strictGate.ready;
  const status = fullOfflineReady ? "FULL_OFFLINE_READY" : gameplayReady ? "GAMEPLAY_READY" : mockReady ? "MOCK_READY" : hybridReady ? "HYBRID_READY" : shellReady ? "SHELL_READY" : "NOT_READY";
  const blockers = [];
  if (!indexHtml) blockers.push("index.html tidak ditemukan");
  if (!names.some((name) => /\.js$/i.test(name))) blockers.push("JavaScript utama tidak ditemukan");
  if (unresolved > 0) blockers.push(`${unresolved} asset masih memiliki URL absolut tanpa localPath`);
  if (failed > 0) blockers.push(`${failed} asset memiliki status gagal`);
  if (hasApi && apiEndpoints.length === 0) blockers.push("API terdeteksi tetapi api-map.json kosong");
  if (apiEndpoints.length > 0 && snapshots.length === 0) blockers.push("Tidak ada snapshot API nyata");
  if (hasRealtime && !hasRuntimeInterceptor) blockers.push("Realtime terdeteksi tetapi runtime/realtime adapter tidak ada di paket");
  for (const item of criticalReplicationBlockers) blockers.push(item.message || `Blocker kritis: ${item.kind || "unknown"}`);
  if (!browser.gameplayReady) blockers.push("Browser gameplay test belum berhasil");
  if (!browser.networkIsolated) blockers.push("Network isolation belum terbukti");
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    status,
    shellReady,
    hybridReady,
    mockReady,
    gameplayReady,
    fullOfflineReady,
    browserTest: browser,
    assets: { files: names.length, indexHtml, unresolved, failed, externalRefs: externalRefs.length },
    api: { detected: hasApi, endpoints: apiEndpoints.length, snapshots: snapshots.length, contracts: Array.isArray(apiMap?.contracts) ? apiMap.contracts.length : 0, replaySequence: Array.isArray(apiMap?.replaySequence) ? apiMap.replaySequence.length : 0 },
    realtime: { detected: hasRealtime, adapterPresent: hasRuntimeInterceptor },
    sourceReports: { hasManifest: Boolean(manifest), hasApiMap: Boolean(apiMap), hasOfflineSuper: Boolean(superReport), hasCollectStatus: Boolean(statusReport), hasReplicationReport: Boolean(replicationReport), hasAuthorizedResearch: Boolean(authorizedResearch) },
    strictGate,
    blockers: [...blockers, ...strictBlockers.filter((item) => !blockers.includes(item))],
    externalRefs
  };
}

export function validateZipPackage(zipData, options = {}) {
  const entries = unzipSync(zipData);
  return validatePackageFiles(entries, options);
}

export function assertPackageReady(report, expected = "FULL_OFFLINE_READY") {
  if (report?.status !== expected) throw new Error(`Paket belum ${expected}: ${JSON.stringify(report?.blockers || [])}`);
  return report;
}

export default validatePackageFiles;
