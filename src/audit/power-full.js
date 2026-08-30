const REQUIRED_API_KINDS = ["session", "init", "balance", "spin", "result"];

function asArray(value, max = 500) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function text(value, max = 300) {
  return String(value == null ? "" : value).slice(0, max);
}

function finding(code, severity, phase, message, remediation, evidence = {}) {
  return { code, severity, phase, message, remediation, evidence };
}

function hasKind(contract, kind) {
  const value = text(contract?.kind || contract?.name || contract?.path, 200).toLowerCase();
  return REQUIRED_API_KINDS.some((required) => required === kind && value.includes(required));
}

function inferApiKinds(input) {
  const contracts = asArray(input.apiContract || input.contract || input.apiMap?.contract || input.apiMap?.contracts);
  const explicit = asArray(input.apiKinds).map((item) => text(item, 40).toLowerCase());
  const kinds = new Set(explicit);
  for (const contract of contracts) {
    for (const required of REQUIRED_API_KINDS) if (hasKind({ ...contract, kind: contract?.kind || contract?.name || contract?.path }, required)) kinds.add(required);
  }
  return { contracts, kinds };
}

export function buildPowerFullAudit(input = {}) {
  const manifest = asArray(input.manifest || input.files || input.package?.manifest, 5000);
  const requests = asArray(input.networkRequests || input.network || input.runtime?.requests);
  const browser = input.browserTest || input.networkOff || {};
  const security = input.securityEvidence || input.security || {};
  const { contracts, kinds } = inferApiKinds(input);
  const findings = [];
  const blockers = [];
  const warnings = [];
  const hasFile = (pattern) => manifest.some((entry) => pattern.test(text(typeof entry === "string" ? entry : entry?.path || entry?.name, 500)));
  const networkViolations = requests.filter((request) => request?.networkOffBlocked === false || request?.allowed === false || request?.outbound === true || request?.status === "NETWORK_VIOLATION");
  const missingAssets = asArray(input.missingAssets || input.missing || input.assetGaps, 1000);
  const securitySignals = asArray(security.signals || security.findings || input.securitySignals, 200);
  const securityBlocked = security.blocked === true || security.requiresAuthorization === true || securitySignals.some((signal) => /drm|license|anti.?bot|captcha|restriction|signature/i.test(text(signal?.type || signal?.code || signal, 200)) && signal?.authorized !== true);
  const authorized = input.authorizedResearch === true || input.authorizedResearch?.enabled === true || security.authorizedResearch === true;

  if (!manifest.length) blockers.push(finding("PACKAGE_EMPTY", "blocker", "package", "Manifest ZIP tidak berisi file yang dapat diaudit.", "Collect ulang dan pastikan ZIP berisi index, loader, asset, dan metadata."));
  if (!hasFile(/(^|\/)index\.html?$/i)) blockers.push(finding("INDEX_MISSING", "blocker", "package", "index.html tidak ditemukan pada manifest.", "Pastikan entry document game ikut masuk ke ZIP."));
  if (!hasFile(/\.(?:js|mjs|cjs)$/i)) blockers.push(finding("SCRIPT_MISSING", "blocker", "package", "Tidak ada JavaScript client pada manifest.", "Capture loader dan bundle JavaScript yang benar-benar dipakai runtime."));
  if (missingAssets.length) blockers.push(finding("ASSET_MISSING", "blocker", "assets", `${missingAssets.length} asset masih hilang atau belum terpetakan ke lokal.`, "Unduh asset berizin, verifikasi MIME/hash, lalu rewrite referensinya ke localPath.", { count: missingAssets.length, sample: missingAssets.slice(0, 10) }));
  if (networkViolations.length) blockers.push(finding("NETWORK_OFF_VIOLATION", "blocker", "runtime", `${networkViolations.length} request keluar saat network-off.`, "Tambahkan fixture/replay lokal atau tandai dependency online sebagai blocker; jangan bypass kontrol provider.", { count: networkViolations.length, sample: networkViolations.slice(0, 10) }));

  for (const required of REQUIRED_API_KINDS) {
    if (!kinds.has(required)) blockers.push(finding(`API_${required.toUpperCase()}_MISSING`, "blocker", "api", `Kontrak API ${required} belum terbukti.`, "Capture request, response, schema, dan urutannya pada sesi berizin."));
  }
  if (!contracts.length && !kinds.size) blockers.push(finding("API_CONTRACT_EMPTY", "blocker", "api", "Tidak ada API contract atau apiKinds yang dapat diverifikasi.", "Jalankan capture session → init → balance → spin → result dengan metadata yang sudah direda​ksi."));

  if (securityBlocked && !authorized) blockers.push(finding("AUTHORIZED_RESEARCH_REQUIRED", "security", "security", "Sinyal DRM, license, anti-bot, signature, atau restriction ditemukan tanpa otorisasi riset yang tercatat.", "Gunakan Authorized Research Mode dengan license reference dan konfirmasi manual; sistem tidak melakukan bypass.", { signals: securitySignals.slice(0, 10) }));
  else if (securityBlocked && authorized) warnings.push(finding("SECURITY_EVIDENCE_RECORDED", "warning", "security", "Security evidence ditemukan dan tercatat pada mode berizin.", "Pertahankan bukti izin, scope, dan audit log pada laporan final."));

  const browserIsolated = browser.networkIsolated === true || browser.networkOff === true;
  const gameplayReady = browser.gameplayReady === true || browser.status === "PASS" || browser.status === "FULL_OFFLINE_READY";
  if (!browserIsolated) blockers.push(finding("BROWSER_NETWORK_OFF_NOT_PROVEN", "blocker", "browser", "Browser test tanpa network belum terbukti.", "Jalankan test pada halaman ZIP ini dengan request network diblokir dan simpan log hasilnya."));
  if (!gameplayReady) blockers.push(finding("BROWSER_GAMEPLAY_NOT_PROVEN", "blocker", "browser", "Alur gameplay offline belum berhasil dibuktikan.", "Uji load → session → init → balance → spin → result tanpa network."));

  const external = requests.filter((request) => request?.external === true || request?.local === false || /https?:\/\//i.test(text(request?.url, 500)));
  if (external.length && !networkViolations.length) warnings.push(finding("EXTERNAL_EVIDENCE_PRESENT", "warning", "runtime", `${external.length} request eksternal tercatat pada evidence.`, "Pastikan request tersebut hanya berasal dari fase capture/authorized research dan tidak muncul pada browser network-off.", { count: external.length }));
  if (!hasFile(/manifest\.json$/i)) warnings.push(finding("MANIFEST_NOT_FOUND", "warning", "package", "manifest.json tidak ditemukan pada ZIP.", "Simpan manifest immutable dengan path, MIME, byte size, dan SHA-256."));

  const checks = {
    package: !blockers.some((item) => item.phase === "package" || item.phase === "assets"),
    api: REQUIRED_API_KINDS.every((kind) => kinds.has(kind)),
    security: !blockers.some((item) => item.code === "AUTHORIZED_RESEARCH_REQUIRED"),
    browserNetworkOff: browserIsolated && networkViolations.length === 0,
    gameplay: gameplayReady
  };
  const score = Math.max(0, Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100));
  const ready = blockers.length === 0 && Object.values(checks).every(Boolean);
  return {
    version: 2,
    mode: "power-full",
    generatedAt: new Date().toISOString(),
    status: ready ? "FULL_OFFLINE_READY" : securityBlocked && !authorized ? "AUTHORIZED_RESEARCH_REQUIRED" : "NOT_READY",
    decision: ready ? "PASS" : "BLOCK",
    score,
    checks,
    counts: { manifest: manifest.length, contracts: contracts.length, requestEvidence: requests.length, missingAssets: missingAssets.length, networkViolations: networkViolations.length, securitySignals: securitySignals.length },
    blockers,
    warnings,
    policy: { authorizedResearchRequired: true, bypassControls: false, networkOffRequired: true, perPackageEvidence: true },
    nextActions: blockers.slice(0, 12).map((item) => item.remediation)
  };
}

export default buildPowerFullAudit;
