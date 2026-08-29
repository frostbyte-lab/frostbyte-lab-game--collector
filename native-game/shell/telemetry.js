const SENSITIVE_KEYS = /authorization|cookie|password|secret|token|credential|private.?key|query|body/i;

export function sanitizeUrl(input) {
  try {
    const url = new URL(String(input), globalThis.location?.origin || "https://native.invalid");
    url.search = "";
    url.hash = "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

export function sanitize(value, depth = 0) {
  if (depth > 4 || value == null) return value;
  if (typeof value === "string") return value.length > 240 ? `${value.slice(0, 240)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEYS.test(key))
      .map(([key, item]) => [key, sanitize(item, depth + 1)]));
  }
  return value;
}

export function record(event, details = {}) {
  const entry = {
    event: String(event),
    correlation_id: globalThis.crypto?.randomUUID?.() || `corr-${Date.now()}`,
    status_code: details.status_code ?? 200,
    duration_ms: Number(details.duration_ms || 0),
    sanitized_url: details.url ? sanitizeUrl(details.url) : undefined,
    timestamp: new Date().toISOString(),
    ...sanitize(details)
  };
  delete entry.url;
  globalThis.dispatchEvent?.(new CustomEvent("native-telemetry", { detail: entry }));
  return entry;
}
