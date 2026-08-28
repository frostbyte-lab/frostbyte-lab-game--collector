const SENSITIVE_HEADER = /authorization|cookie|set-cookie|x-api-key|proxy-auth/i;
const MAX_BODY_CHARS = 12000;
const MAX_KEYS = 80;

function cleanHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const name = String(key).toLowerCase();
    if (SENSITIVE_HEADER.test(name)) {
      out[name] = "<redacted>";
      continue;
    }
    out[name] = String(value).slice(0, 500);
  }
  return out;
}

function parseBody(raw) {
  if (raw == null || raw === "") return null;
  const text = String(raw).slice(0, MAX_BODY_CHARS);
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (_) {}
  return { __text: text };
}

function fieldShape(value, depth = 0) {
  if (depth > 3) return typeof value;
  if (Array.isArray(value)) return { type: "array", item: value.length ? fieldShape(value[0], depth + 1) : "unknown" };
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, MAX_KEYS).map(([key, item]) => [key, fieldShape(item, depth + 1)]));
  }
  return typeof value;
}

function topKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).slice(0, MAX_KEYS)
    : [];
}

export function buildApiContract({
  url,
  method = "GET",
  requestHeaders = {},
  requestBody = null,
  status = 200,
  responseHeaders = {},
  responseBody = null,
  kind = "api",
  confidence = "low"
} = {}) {
  let parsedResponse = responseBody;
  if (typeof responseBody === "string") {
    try { parsedResponse = JSON.parse(responseBody.slice(0, MAX_BODY_CHARS)); } catch (_) { parsedResponse = null; }
  }
  let target = null;
  try {
    const parsed = new URL(String(url));
    target = {
      origin: parsed.origin,
      path: parsed.pathname || "/",
      queryKeys: [...parsed.searchParams.keys()].slice(0, 40)
    };
  } catch (_) {
    target = { path: String(url || "").slice(0, 500), queryKeys: [] };
  }
  return {
    version: 1,
    kind,
    confidence,
    method: String(method || "GET").toUpperCase(),
    url: String(url || "").slice(0, 1000),
    target,
    request: {
      headers: cleanHeaders(requestHeaders),
      body: parseBody(requestBody),
      bodyPresent: requestBody != null && String(requestBody).length > 0
    },
    response: {
      status: Number(status) || 0,
      headers: cleanHeaders(responseHeaders),
      contentType: responseHeaders?.["content-type"] || responseHeaders?.["Content-Type"] || null,
      topKeys: topKeys(parsedResponse),
      fields: fieldShape(parsedResponse)
    }
  };
}

export function mergeApiContracts(previous, next) {
  if (!previous) return next || null;
  if (!next) return previous;
  return {
    ...previous,
    request: { ...previous.request, ...next.request, headers: { ...previous.request?.headers, ...next.request?.headers } },
    response: { ...previous.response, ...next.response, headers: { ...previous.response?.headers, ...next.response?.headers } },
    samples: [...(previous.samples || []), next].slice(-5)
  };
}
