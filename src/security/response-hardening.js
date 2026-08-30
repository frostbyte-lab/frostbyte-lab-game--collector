const DEFAULT_ORIGIN = "https://game-resource-collector.technologiesfrostbyte.workers.dev";
const buckets = new Map();

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allowed = String(env.CORS_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, "");
  return origin === allowed ? origin : null;
}

function headersFor(request, env, contentType = "") {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin"
  };
  if (/text\/html/i.test(contentType)) {
    headers["Content-Security-Policy"] = String(env.CONTENT_SECURITY_POLICY || "default-src 'self'; base-uri 'self'; frame-ancestors 'self'; object-src 'none'; connect-src 'self' https://api.github.com https://*.workers.dev; img-src 'self' data: blob: https:; media-src 'self' blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:");
  }
  const allowed = originAllowed(request, env);
  if (allowed) {
    headers["Access-Control-Allow-Origin"] = allowed;
    headers["Vary"] = "Origin";
  }
  return headers;
}

export function withSecurityHeaders(response, request, env) {
  const out = new Headers(response.headers);
  const contentType = out.get("Content-Type") || "";
  for (const [key, value] of Object.entries(headersFor(request, env, contentType))) out.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: out });
}

export function preflightResponse(request, env) {
  const allowed = originAllowed(request, env);
  if (!allowed) return Response.json({ ok: false, error: "CORS_ORIGIN_NOT_ALLOWED" }, { status: 403 });
  const headers = headersFor(request, env, "application/json");
  headers["Access-Control-Allow-Methods"] = "GET,HEAD,POST,OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With";
  headers["Access-Control-Max-Age"] = "600";
  return new Response(null, { status: 204, headers });
}

export function checkRateLimit(request, env, { limit = 60, windowMs = 60_000 } = {}) {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/") || request.method === "OPTIONS") return null;
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "anonymous";
  const key = `${ip}:${pathname}`;
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return null; }
  current.count += 1;
  if (current.count <= limit) return null;
  return withSecurityHeaders(Response.json({ ok: false, error: "RATE_LIMITED", retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((current.resetAt - now) / 1000)), "Cache-Control": "no-store" } }), request, env);
}

export function addCapabilityScopes(report) {
  return { ...report, scopeModel: { worker: "collector, analyzers, validators, reports, API replay/mock", labLocal: "WABT, mitmproxy, Wireshark/tshark, Ghidra", unavailable: "tool absent from both runtime environments" }, tools: (report.tools || []).map((tool) => ({ ...tool, executionScope: tool.status === "external" ? "lab-local" : tool.status === "partial" ? "worker-or-lab" : "worker" })) };
}
