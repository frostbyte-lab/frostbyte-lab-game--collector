const MAX_EVIDENCE_BYTES = 256 * 1024;
const PRIVATE_HOST = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.|::1$)/i;
const SENSITIVE_KEY = /(token|secret|password|passwd|cookie|authorization|credential|session|private.?key|access.?key)/i;

function clean(value, depth = 0) {
  if (depth > 6) return '[TRUNCATED]';
  if (typeof value === 'string') return value.length > 800 ? `${value.slice(0, 800)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => clean(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 300)) out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : clean(item, depth + 1);
    return out;
  }
  return value;
}

export function normalizeResearchTarget(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port)) return null;
    if (PRIVATE_HOST.test(url.hostname) || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')) return null;
    return url;
  } catch { return null; }
}

export function validateResearchScope(body = {}) {
  const target = normalizeResearchTarget(body.target || body.url);
  const reference = String(body.authorization?.reference || body.licenseRef || '').trim().slice(0, 160);
  const confirmed = body.authorization?.confirmed === true || body.authorized === true;
  if (!target) return { ok: false, code: 'TARGET_INVALID', message: 'Target harus URL HTTP(S) publik tanpa credential, private host, atau port custom.' };
  if (!confirmed || !reference) return { ok: false, code: 'AUTHORIZATION_REQUIRED', message: 'Riset memerlukan konfirmasi izin dan reference izin tertulis.' };
  const allowedHosts = Array.isArray(body.scope?.allowedHosts) ? body.scope.allowedHosts.map((x) => String(x).toLowerCase()).slice(0, 20) : [];
  if (allowedHosts.length && !allowedHosts.some((host) => target.hostname === host || target.hostname.endsWith(`.${host}`))) return { ok: false, code: 'SCOPE_DENIED', message: 'Host berada di luar allowlist scope riset.' };
  return { ok: true, target: target.toString(), hostname: target.hostname, reference, mode: 'authorized-security-research' };
}

function finding(code, severity, title, evidence, remediation, confidence = 'high') {
  return { code, severity, title, evidence: clean(evidence), remediation, confidence, execution: 'passive-evidence-only' };
}

export function analyzeSecurityEvidence(evidence = {}) {
  const safe = clean(evidence);
  const findings = [];
  const headers = safe.headers || safe.responseHeaders || {};
  const headerNames = Object.keys(headers).map((key) => key.toLowerCase());
  const urls = Array.isArray(safe.urls) ? safe.urls.map(String) : [];
  const errors = Array.isArray(safe.errors) ? safe.errors : [];
  if (!headerNames.includes('content-security-policy')) findings.push(finding('SEC-001', 'high', 'Content-Security-Policy tidak terdeteksi', { headers: headerNames }, 'Tambahkan CSP bertahap dan uji report-only sebelum enforcement.'));
  if (!headerNames.includes('strict-transport-security')) findings.push(finding('SEC-002', 'medium', 'Strict-Transport-Security tidak terdeteksi', { headers: headerNames }, 'Aktifkan HSTS hanya setelah seluruh traffic aman melalui HTTPS.'));
  if (String(headers['access-control-allow-origin'] || headers['Access-Control-Allow-Origin'] || '') === '*') findings.push(finding('SEC-003', 'high', 'CORS wildcard terdeteksi', { header: 'Access-Control-Allow-Origin', value: '[REDACTED]' }, 'Ganti wildcard dengan allowlist origin yang diperlukan dan jangan izinkan credential pada wildcard.'));
  if (urls.some((url) => /[?&](token|sig|sign|key)=/i.test(url))) findings.push(finding('SEC-004', 'high', 'URL bertanda tangan atau credential-like ditemukan di evidence', { count: urls.filter((url) => /[?&](token|sig|sign|key)=/i.test(url)).length }, 'Redact URL dari log, gunakan referensi server-side, dan rotasi credential bila benar-benar terekspos.'));
  if (urls.some((url) => /license|widevine|fairplay|playready|eme|drm/i.test(url)) || errors.some((error) => /drm|requestMediaKeySystemAccess/i.test(String(error)))) findings.push(finding('SEC-005', 'critical', 'Resource DRM/licensing terdeteksi', { protectedSignals: true }, 'Hentikan audit runtime; dokumentasikan sinyal dan minta izin provider. Jangan bypass atau mengekstrak key.'));
  if (errors.some((error) => /captcha|cloudflare challenge|bot check|access denied/i.test(String(error)))) findings.push(finding('SEC-006', 'high', 'Kontrol anti-bot atau akses ditolak terdeteksi', { errors: errors.slice(0, 5) }, 'Catat sebagai blocker dan gunakan jalur integrasi resmi; jangan mencoba melewati kontrol.'));
  if (urls.some((url) => /^http:\/\//i.test(url))) findings.push(finding('SEC-007', 'medium', 'Resource HTTP non-aman ditemukan', { count: urls.filter((url) => /^http:\/\//i.test(url)).length }, 'Migrasikan resource ke HTTPS atau dokumentasikan exception yang disetujui.'));
  if (errors.some((error) => /eval\s*\(|innerHTML\s*=|document\.write/i.test(String(error)))) findings.push(finding('SEC-008', 'medium', 'Sink JavaScript berisiko terindikasi oleh evidence', { errors: errors.slice(0, 5) }, 'Validasi input, gunakan textContent atau Trusted Types, dan hilangkan eval bila tidak wajib.', 'medium'));
  const score = Math.max(0, 100 - findings.reduce((sum, item) => sum + ({ critical: 30, high: 18, medium: 9, low: 3 }[item.severity] || 0), 0));
  return { version: 1, mode: 'authorized-security-research', execution: 'passive-evidence-only', bypass: false, score, level: score >= 85 ? 'LOW' : score >= 60 ? 'MEDIUM' : score >= 30 ? 'HIGH' : 'CRITICAL', findings, evidence: safe, limitations: ['Tidak melakukan auto-fetch.', 'Tidak mengirim credential.', 'Tidak melewati DRM, CAPTCHA, login, lisensi, atau anti-bot.', 'Temuan perlu diverifikasi pada aset yang dimiliki atau telah diizinkan.'] };
}

export async function handleResearchAudit(request) {
  if (request.method !== 'POST') return Response.json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_EVIDENCE_BYTES) return Response.json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 }); }
  const size = new TextEncoder().encode(JSON.stringify(body || {})).byteLength;
  if (size > MAX_EVIDENCE_BYTES) return Response.json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  const scope = validateResearchScope(body);
  if (!scope.ok) return Response.json({ ok: false, error: scope.code, message: scope.message }, { status: 403 });
  return Response.json({ ok: true, scope: { ...scope, target: scope.hostname }, report: analyzeSecurityEvidence(body.evidence || {}) }, { headers: { 'Cache-Control': 'no-store', 'X-GC-Research-Mode': 'authorized-evidence-only' } });
}

export { MAX_EVIDENCE_BYTES };
