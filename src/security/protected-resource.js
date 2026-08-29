const PATTERNS = [
  { type: "DRM", pattern: /(?:encrypted.?media|media.?keys|requestMediaKeySystemAccess|widevine|playready|fairplay|clearkey|\bcdm\b|\bdrm\b|license(?:[-_ ]|url|server|request|response))/i },
  { type: "TOKEN", pattern: /(?:access[_-]?token|refresh[_-]?token|id[_-]?token|bearer\s+[A-Za-z0-9._~-]{12,}|jwt|authorization)/i },
  { type: "COOKIE", pattern: /(?:set-cookie|document\.cookie|cookie\s*[:=])/i },
  { type: "PRIVATE_KEY", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { type: "SIGNED_REQUEST", pattern: /(?:signed[_-]?request|signature\s*[:=]|x-(?:amz|sign|signature)|hmac|presigned)/i },
  { type: "PROTECTED_BINARY", pattern: /(?:encrypted|obfuscated|packed|protected).{0,40}(?:binary|wasm|module|payload)/i },
  { type: "EXTERNAL_BACKEND", pattern: /(?:private|internal|provider).{0,30}(?:backend|protocol|endpoint)/i }
];

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
  /((?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;"']+/gi,
  /((?:password|client_secret|private_key)\s*[:=]\s*)([^\s,;"']+)/gi,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi
];

export const PROTECTED_TYPES = Object.freeze(PATTERNS.map(({ type }) => type));

export function detectProtectedResource(input, metadata = {}) {
  const url = String(metadata.url || "");
  const path = String(metadata.path || "");
  const content = typeof input === "string" ? input : JSON.stringify(input ?? "");
  const haystack = `${url}\n${path}\n${content}`;
  const findings = PATTERNS.filter(({ pattern }) => pattern.test(haystack)).map(({ type }) => type);
  const unique = [...new Set(findings)];
  return {
    blocked: unique.length > 0,
    permission_status: unique.length > 0 ? "BLOCKED" : (metadata.permission_status || "UNKNOWN"),
    protected_types: unique,
    reasons: unique.map((type) => `protected_resource:${type}`),
    sanitized: false
  };
}

export function sanitizeProtectedText(input) {
  let output = String(input ?? "");
  const redactions = [];
  for (const pattern of SECRET_PATTERNS) {
    const before = output;
    output = output.replace(pattern, (_match, prefix = "[REDACTED]") => `${prefix}[REDACTED]`);
    if (before !== output) redactions.push("sensitive_value");
  }
  return { value: output, redacted: redactions.length > 0, redactions: [...new Set(redactions)] };
}

export function classifyCaptureResource(resource = {}) {
  const detection = detectProtectedResource(resource.content || resource.text || "", resource);
  const sanitized = typeof resource.content === "string" ? sanitizeProtectedText(resource.content) : { value: resource.content, redacted: false, redactions: [] };
  return {
    ...resource,
    content: sanitized.value,
    permission_status: detection.blocked ? "BLOCKED" : (resource.permission_status || detection.permission_status),
    protected_component: detection.blocked,
    protected_types: detection.protected_types,
    blocked_reason: detection.reasons,
    redactions: sanitized.redactions,
    release_allowed: !detection.blocked && ["AUTHORIZED_OWNER", "AUTHORIZED_LICENSE", "AUTHORIZED_API"].includes(resource.permission_status || detection.permission_status)
  };
}

export function filterReleaseResources(resources = []) {
  const classified = resources.map(classifyCaptureResource);
  return {
    allowed: classified.filter((resource) => resource.release_allowed),
    blocked: classified.filter((resource) => !resource.release_allowed),
    audit: classified.map(({ path, url, permission_status, protected_component, protected_types, redactions, release_allowed }) => ({ path, url, permission_status, protected_component, protected_types, redactions, release_allowed }))
  };
}
