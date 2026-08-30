/**
 * A Core Raa — standalone evidence intelligence for Game Collector.
 * No external model, provider, network call, or hidden execution.
 */
import { ARAA_CASE_DATASET, ARAA_DATASET_VERSION, matchAraaDataset } from "./araa-dataset.js";
export const ARAA_IDENTITY = Object.freeze({
  name: "A Core Raa",
  version: "1.0.0",
  owner: "Game Collector",
  mode: "standalone-evidence-intelligence",
  externalAI: false
});

const SECRET_KEY = /authorization|cookie|set-cookie|token|secret|password|passwd|signature|api[-_]?key|access[-_]?key|private[-_]?key/i;
function asArray(value) { return Array.isArray(value) ? value : []; }
function asObject(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function text(value, max = 400) { return String(value == null ? "" : value).replace(/[\u0000-\u001f]/g, " ").slice(0, max); }

export function redactAraaEvidence(value, depth = 0) {
  if (depth > 5) return "[depth-limited]";
  if (Array.isArray(value)) return value.slice(0, 500).map((v) => redactAraaEvidence(v, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? text(value, 600) : value;
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 300)) out[key] = SECRET_KEY.test(key) ? "[redacted]" : redactAraaEvidence(item, depth + 1);
  return out;
}
function finding(id, severity, title, detail, evidence, action) { return { id, severity, title, detail, evidence: text(evidence, 500), action: text(action, 500) }; }

export function analyzeAraaEvidence(input = {}) {
  const evidence = asObject(redactAraaEvidence(input));
  const manifest = asObject(evidence.manifest);
  const analysis = asObject(evidence.analysis);
  const capture = asObject(evidence.capture);
  const security = asObject(evidence.security);
  const files = asArray(evidence.files || manifest.files || analysis.files);
  const missing = asArray(evidence.missingAssets || analysis.missingAssets || analysis.missing);
  const errors = asArray(evidence.errors || capture.errors || analysis.errors);
  const protectedItems = asArray(evidence.protectedResources || security.protectedResources);
  const api = asArray(evidence.api || evidence.apiEndpoints || analysis.apiEndpoints);
  const deps = asArray(evidence.dependencies || analysis.dependencies);
  const totalFiles = number(evidence.totalFiles || capture.files || manifest.totalFiles || files.length);
  const totalBytes = number(evidence.totalBytes || capture.bytes || manifest.totalBytes);
  const findings = [];
  const datasetSignals = matchAraaDataset([
    JSON.stringify(evidence),
    ...errors,
    ...missing,
    ...protectedItems,
    ...api,
    ...deps
  ]);
  const hasManifest = Object.keys(manifest).length > 0 || Boolean(evidence.manifestHash);
  const hasIntegrity = Boolean(evidence.integrity || evidence.hashes || manifest.integrity || manifest.hash);
  const hasDependencyGraph = Boolean(evidence.dependencyGraph || evidence.graph || deps.length);
  const hasApiMap = Boolean(evidence.apiMap || api.length);
  if (!hasManifest) findings.push(finding("ARAA-MANIFEST", "high", "Manifest belum tersedia", "A Core Raa tidak dapat membuktikan daftar file tanpa manifest.", "manifest kosong", "Jalankan capture atau audit ZIP lalu buat manifest."));
  if (missing.length) findings.push(finding("ARAA-ASSET", "high", "Asset hilang terdeteksi", `${missing.length} asset belum ditemukan.`, `${missing.length} missing asset`, "Periksa URL relatif, base path, dan asset yang dilindungi."));
  if (errors.length) findings.push(finding("ARAA-ERROR", "high", "Error capture/analyzer ditemukan", `${errors.length} error tercatat dalam evidence.`, errors.slice(0, 3).map((value) => text(value)).join(" | "), "Buka log detail dan ulangi tahap yang gagal."));
  if (protectedItems.length) findings.push(finding("ARAA-PROTECTED", "blocked", "Resource terlindungi", `${protectedItems.length} resource ditandai protected/blocked.`, `${protectedItems.length} protected resource`, "Gunakan resource resmi yang memang boleh diakses; A Core Raa tidak melewati kontrol akses."));
  if (!hasIntegrity) findings.push(finding("ARAA-INTEGRITY", "medium", "Bukti integrity belum lengkap", "Hash atau manifest integrity belum ditemukan.", "integrity evidence kosong", "Buat hash manifest dan jalankan validasi ulang."));
  if (!hasDependencyGraph) findings.push(finding("ARAA-GRAPH", "medium", "Dependency graph belum lengkap", "Hubungan antarfile belum cukup untuk diagnosis menyeluruh.", "dependency graph tidak tersedia", "Jalankan analyzer dependency dan relations."));
  if (!hasApiMap && totalFiles > 0) findings.push(finding("ARAA-API", "low", "API map belum tersedia", "Runtime/API belum terpetakan pada evidence.", "api map kosong", "Jalankan API schema analyzer atau conformance test."));
  if (totalBytes > 56 * 1024 * 1024) findings.push(finding("ARAA-SIZE", "medium", "Paket melebihi batas Worker", `Ukuran terdeteksi sekitar ${Math.round(totalBytes / 1024 / 1024)} MB.`, `${totalBytes} bytes`, "Gunakan jalur runner besar dan pecah proses packaging."));
  const penalties = { high: 22, blocked: 18, medium: 10, low: 4 };
  const score = Math.max(0, Math.min(100, 100 - findings.reduce((sum, item) => sum + (penalties[item.severity] || 0), 0)));
  const level = score >= 85 ? "STRONG" : score >= 65 ? "CONDITIONAL" : score >= 40 ? "WEAK" : "BLOCKED";
  const priorities = findings.slice().sort((a, b) => (penalties[b.severity] || 0) - (penalties[a.severity] || 0)).map((item, index) => ({ priority: index + 1, findingId: item.id, action: item.action }));
  return { identity: ARAA_IDENTITY, generatedAt: new Date().toISOString(), mode: "standalone", score, level, facts: [`Evidence files: ${totalFiles}`, `Missing assets: ${missing.length}`, `Errors: ${errors.length}`, `Protected resources: ${protectedItems.length}`, `API endpoints: ${api.length}`, `Dataset patterns: ${datasetSignals.length}`, `Score: ${score}/100 (${level})`], findings, priorities, dataset: { version: ARAA_DATASET_VERSION, caseCount: ARAA_CASE_DATASET.length, matched: datasetSignals }, nextAction: priorities[0]?.action || "Evidence minimum terpenuhi; lanjutkan validasi offline dan regression test.", explainability: { ruleCount: 8, datasetCaseCount: ARAA_CASE_DATASET.length, evidenceBound: true, externalProvider: false } };
}
export function buildAraaActivity(evidence = {}) { const result = analyzeAraaEvidence(evidence); return { ...result, activity: { title: "A Core Raa", subtitle: "Standalone Evidence Intelligence", status: result.level, summary: result.nextAction } }; }
