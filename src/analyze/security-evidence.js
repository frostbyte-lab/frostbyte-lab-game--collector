const RULES = [
  {
    kind: "drm",
    severity: "critical",
    re: /encryptedmedia|mediaKeySystemAccess|requestMediaKeySystemAccess|widevine|playready|fairplay|eme\b/i,
    message: "DRM/Encrypted Media terdeteksi; offline penuh memerlukan integrasi dan hak resmi."
  },
  {
    kind: "license_server",
    severity: "critical",
    re: /license(?:server|url)?|acquirelicense|certificateurl|\.license\b|drm\//i,
    message: "License server atau endpoint lisensi terdeteksi; jangan bypass, gunakan integrasi resmi atau mock berizin."
  },
  {
    kind: "challenge",
    severity: "critical",
    re: /captcha|turnstile|hcaptcha|recaptcha|verify you are human|challenge-platform|cloudflare/i,
    message: "Challenge/anti-bot terdeteksi; penyelesaian harus dilakukan manual dan berizin."
  },
  {
    kind: "authentication",
    severity: "high",
    re: /oauth|openid|authorization_code|pkce|bearer\s|login|signin|session[_-]?token|refresh[_-]?token/i,
    message: "Authentication/session dependency terdeteksi; token tidak boleh direkam sebagai secret."
  },
  {
    kind: "iframe_embed",
    severity: "medium",
    re: /<iframe\b|postMessage\s*\(|contentWindow|parent\.postMessage/i,
    message: "Iframe atau komunikasi embed terdeteksi; frame harus diizinkan atau dipetakan melalui jalur resmi."
  },
  {
    kind: "signed_asset",
    severity: "medium",
    re: /[?&](?:sign|signature|sig|token|expires|x-amz-signature)=|signed-url|presigned/i,
    message: "Signed asset URL terdeteksi; asset harus diambil saat token valid dan diverifikasi secara lokal."
  },
  {
    kind: "realtime",
    severity: "high",
    re: /new\s+WebSocket|WebSocket\s*\(|EventSource\s*\(|wss?:\/\/|socket\.io|server[-_]?sent/i,
    message: "Realtime dependency terdeteksi; capture frame, urutan event, reconnect, dan replay wajib diuji."
  },
  {
    kind: "server_rng_or_signature",
    severity: "high",
    re: /server[_-]?seed|client[_-]?seed|nonce|hmac|sha256|signature|randomness|rng|provably[-_ ]fair/i,
    message: "Indikasi RNG/signature server terdeteksi; hasil offline tidak boleh dianggap ekuivalen tanpa kontrak resmi."
  }
];

function unique(values) { return [...new Set(values.filter(Boolean))]; }

export function detectSecurityEvidence({ texts = [], urls = [], requests = [] } = {}) {
  const text = [...texts, ...urls, ...requests.map((item) => typeof item === "string" ? item : JSON.stringify(item))].join("\n");
  const findings = [];
  for (const rule of RULES) {
    const matches = text.match(rule.re);
    if (!matches) continue;
    const evidence = unique(matches.map((item) => String(item).slice(0, 120))).slice(0, 8);
    findings.push({ kind: rule.kind, severity: rule.severity, message: rule.message, evidence });
  }
  const critical = findings.filter((item) => item.severity === "critical");
  const high = findings.filter((item) => item.severity === "high");
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    findings,
    summary: {
      total: findings.length,
      critical: critical.length,
      high: high.length,
      medium: findings.filter((item) => item.severity === "medium").length,
      offlineBlocked: critical.length > 0,
      manualReviewRequired: findings.length > 0
    },
    policy: {
      bypassAttempted: false,
      note: "Detection/evidence only. DRM, CAPTCHA, anti-bot, authentication, signature, and access controls are not bypassed."
    }
  };
}

export default detectSecurityEvidence;
