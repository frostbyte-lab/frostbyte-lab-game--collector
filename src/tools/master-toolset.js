const TOOL_DEFINITIONS = [
  ["chromium-playwright", "Chromium + Playwright", "active", "capture", "Browser capture, interaction, auto-spin, dan Play Review"],
  ["chrome-cdp", "Chrome DevTools Protocol (CDP)", "partial", "capture", "Network/runtime instrumentation melalui browser session"],
  ["mitmproxy", "mitmproxy", "external", "capture", "External connector only; authorized lab traffic"],
  ["wireshark", "Wireshark", "external", "capture", "External packet analysis only; no browser bypass"],
  ["ghidra", "Ghidra", "external", "analysis", "External reverse-engineering tool for owned binaries"],
  ["wabt", "WABT", "partial", "analysis", "WASM inspection when WABT runtime is installed"],
  ["ast-parser", "AST Parser", "active", "analysis", "JavaScript source structure and syntax analysis"],
  ["service-worker-analyzer", "Service Worker Analyzer", "active", "offline", "SW cache, scope, fetch handler, and precache checks"],
  ["url-api-detector", "URL/API Detector", "active", "capture", "Absolute URL, API, asset, tracking, and malformed URL detection"],
  ["dependency-graph-engine", "Dependency Graph Engine", "active", "analysis", "Static/runtime dependency graph"],
  ["runtime-discovery-engine", "Runtime Discovery Engine", "active", "capture", "Runtime request and lazy-load discovery"],
  ["url-local-mapping", "URL → Local Mapping", "active", "offline", "Signed URL to verified localPath mapping"],
  ["api-mock-hybrid-backend", "API Mock/Hybrid Backend", "active", "offline", "Stateful mock and authorized hybrid routing"],
  ["integrity-manifest-engine", "Integrity/Manifest Engine", "active", "security", "Hash, manifest, and artifact integrity evidence"],
  ["offline-validator", "Offline Validator", "active", "offline", "Strict network-off readiness quality gate"],
  ["drm-detector-auditor", "DRM Detector/Auditor", "active", "security", "Detect EME/DRM/license signals without bypass"],
  ["html-analyzer", "HTML Analyzer", "active", "analysis", "Markup, iframe, script, and resource analysis"],
  ["css-analyzer", "CSS Analyzer", "active", "analysis", "Stylesheet and url() dependency analysis"],
  ["json-config-analyzer", "JSON/Config Analyzer", "active", "analysis", "Config, manifest, paytable, and schema inspection"],
  ["source-map-analyzer", "Source Map Analyzer", "partial", "analysis", "Source map discovery and linkage"],
  ["js-bundle-analyzer", "JS Bundle Analyzer", "active", "analysis", "Bundle size, imports, and runtime marker analysis"],
  ["web-worker-analyzer", "Web Worker Analyzer", "active", "analysis", "Worker script and message dependency analysis"],
  ["indexeddb-analyzer", "IndexedDB Analyzer", "partial", "offline", "Browser storage evidence in supported preview sessions"],
  ["cache-storage-analyzer", "Cache Storage Analyzer", "active", "offline", "Cache names, entries, and SW coverage"],
  ["cookie-storage-inspector", "Cookie/Storage Inspector", "active", "security", "Redacted cookie/local/session storage evidence"],
  ["redirect-resolver", "Redirect Resolver", "active", "capture", "Redirect chain and final URL evidence"],
  ["mime-validator", "MIME Validator", "active", "security", "Content-type and extension consistency"],
  ["response-validator", "Response Validator", "active", "security", "HTTP status, body, signature, and empty-response checks"],
  ["asset-hash-dedup-engine", "Asset Hash/Dedup Engine", "active", "offline", "SHA-256 dedup for signed URL variants"],
  ["asset-metadata-engine", "Asset Metadata Engine", "active", "analysis", "Size, type, path, and binary signature metadata"],
  ["missing-asset-detector", "Missing Asset Detector", "active", "offline", "Referenced-versus-local asset coverage"],
  ["external-dependency-detector", "External Dependency Detector", "active", "security", "CDN, provider, tracking, and server dependency detection"],
  ["websocket-analyzer", "WebSocket Analyzer", "active", "capture", "Frame, close, and realtime evidence"],
  ["event-console-monitor", "Event/Console Monitor", "active", "capture", "Page errors, console, and runtime event evidence"],
  ["error-recovery-engine", "Error Recovery Engine", "active", "repair", "Safe recovery candidates and blocker classification"],
  ["url-normalizer", "URL Normalizer", "active", "offline", "Signed query normalization and relative URL resolution"],
  ["archive-analyzer", "Archive Analyzer", "active", "analysis", "ZIP/package structure and archive validation"],
  ["file-type-detector", "File Type Detector", "active", "security", "Magic-byte and extension detection"],
  ["network-timeline", "Network Timeline", "active", "capture", "Request/response timing and order"],
  ["request-response-database", "Request/Response Database", "active", "capture", "Redacted API contract and fixture storage"],
  ["api-schema-analyzer", "API Schema Analyzer", "active", "analysis", "Response shape, top keys, and field schema"],
  ["dependency-graph-visualizer", "Dependency Graph Visualizer", "partial", "analysis", "Graph report; UI visualization can be expanded"],
  ["offline-sandbox", "Offline Sandbox", "active", "offline", "Local Play Review with mock/runtime interception"],
  ["build-repack-engine", "Build/Repack Engine", "active", "repair", "Rewrite, backup, and ZIP repack"],
  ["automated-regression-tester", "Automated Regression Tester", "active", "qa", "Offline gameplay and conformance regression tests"],
  ["security-permission-auditor", "Security/Permission Auditor", "active", "security", "Authorized mode, secret redaction, and permission evidence"],
  ["license-restriction-detector", "License/Restriction Detector", "active", "security", "License, auth, restriction, and access-control evidence"],
  ["drm-compliance-reporter", "DRM Compliance Reporter", "active", "security", "Compliance report; no DRM bypass"],
  ["audit-log-engine", "Audit Log Engine", "active", "qa", "Activity/progress/evidence audit trail"],
  ["final-report-generator", "Final Report Generator", "active", "qa", "Manifest, readiness, replication, and blocker reports"]
];

const CAPABILITY_SUMMARY = Object.freeze({
  active: "implemented",
  partial: "partial",
  external: "external-connector"
});

export const MASTER_TOOLSET = Object.freeze(TOOL_DEFINITIONS.map(([id, name, status, category, description], index) => Object.freeze({
  index: index + 1,
  id,
  name,
  status,
  capability: CAPABILITY_SUMMARY[status],
  category,
  description,
  authorizedOnly: ["capture", "security", "repair", "analysis"].includes(category) || status === "external"
})));

export function getMasterToolsetReport() {
  const counts = MASTER_TOOLSET.reduce((out, tool) => {
    out.total++;
    out[tool.status] = (out[tool.status] || 0) + 1;
    out.byCategory[tool.category] = (out.byCategory[tool.category] || 0) + 1;
    return out;
  }, { total: 0, active: 0, partial: 0, external: 0, byCategory: {} });
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    totalRequested: 50,
    tools: MASTER_TOOLSET,
    summary: counts,
    policy: {
      authorizedResearchRequired: true,
      bypassControls: false,
      note: "External tools require explicit authorization and local installation. The platform detects and reports controls; it does not bypass DRM, CAPTCHA, anti-bot, authentication, or access restrictions."
    }
  };
}

export default MASTER_TOOLSET;
