const SECRET_KEY = /authorization|cookie|set-cookie|token|secret|password|signature|api[-_]?key|access[-_]?key|private[-_]?key/i;

export function redactValue(value, depth = 0) {
  if (depth > 4) return '[nested]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 12000 ? value.slice(0, 12000) + '…' : value;
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => redactValue(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 120)) {
      out[key] = SECRET_KEY.test(key) ? '<redacted>' : redactValue(item, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, 500);
}

export function normalizeEndpoint(input = {}) {
  const rawUrl = String(input.url || input.path || input.endpoint || '').trim();
  let path = rawUrl;
  try { path = new URL(rawUrl, 'https://collector.invalid').pathname; } catch (_) {}
  path = path.replace(/\/+/g, '/').replace(/\/\d{2,}(?=\/|$)/g, '/:id').replace(/[a-f0-9]{16,}/gi, ':hash');
  return { method: String(input.method || 'GET').toUpperCase(), path: path || '/', status: Number(input.status ?? input.statusCode ?? 0) || 0 };
}

export function classifyEndpoint(endpoint = {}) {
  const text = `${endpoint.method} ${endpoint.path}`.toLowerCase();
  if (/session|auth|login|token/.test(text)) return 'session';
  if (/balance|wallet|credit|money/.test(text)) return 'balance';
  if (/spin|play|bet|round|game/.test(text)) return 'spin';
  if (/result|payout|win|settle/.test(text)) return 'result';
  if (/bonus|freespin|free-spin|feature/.test(text)) return 'bonus';
  if (/history|transaction/.test(text)) return 'history';
  return 'other';
}

export function buildConformanceReport(input = {}) {
  const exchanges = Array.isArray(input.exchanges) ? input.exchanges : Array.isArray(input.requests) ? input.requests : [];
  const states = Array.isArray(input.states) ? input.states : [];
  const realtime = Array.isArray(input.realtime) ? input.realtime : [];
  const endpoints = exchanges.map((item, index) => {
    const endpoint = normalizeEndpoint(item);
    return {
      index,
      ...endpoint,
      kind: item.kind || classifyEndpoint(endpoint),
      requestCaptured: item.request != null || item.requestBody != null,
      responseCaptured: item.response != null || item.responseBody != null,
      redacted: redactValue(item)
    };
  });
  const kinds = new Set(endpoints.map((item) => item.kind));
  const requiredKinds = ['session', 'balance', 'spin', 'result'];
  const missingKinds = requiredKinds.filter((kind) => !kinds.has(kind));
  const order = endpoints.map((item) => item.kind);
  const orderProblems = [];
  if (order.indexOf('session') >= 0 && order.indexOf('spin') >= 0 && order.indexOf('session') > order.indexOf('spin')) orderProblems.push('session muncul setelah spin');
  if (order.indexOf('balance') >= 0 && order.indexOf('spin') >= 0 && order.indexOf('balance') > order.indexOf('spin')) orderProblems.push('balance awal muncul setelah spin');
  if (order.indexOf('result') >= 0 && order.indexOf('spin') >= 0 && order.indexOf('result') < order.indexOf('spin')) orderProblems.push('result muncul sebelum spin');
  const blockers = [];
  if (!exchanges.length) blockers.push('Tidak ada exchange API yang dicapture.');
  for (const kind of missingKinds) blockers.push(`Kontrak ${kind} belum tercapture.`);
  if (orderProblems.length) blockers.push(...orderProblems);
  if (realtime.some((event) => event && event.transport && !['websocket', 'sse', 'polling'].includes(String(event.transport).toLowerCase()))) blockers.push('Transport realtime tidak dikenal.');
  return {
    version: 1,
    status: blockers.length ? 'NOT_CONFORMANT' : 'CONTRACT_COVERAGE_READY',
    score: Math.round(((requiredKinds.length - missingKinds.length) / requiredKinds.length) * 100),
    counts: { exchanges: exchanges.length, endpoints: endpoints.length, states: states.length, realtime: realtime.length },
    requiredKinds,
    coveredKinds: requiredKinds.filter((kind) => kinds.has(kind)),
    missingKinds,
    order,
    orderProblems,
    realtimeCoverage: realtime.map((event) => ({ transport: String(event.transport || 'unknown'), type: String(event.type || 'event'), sequence: Number(event.sequence ?? 0) || 0, payload: redactValue(event.payload ?? event.data ?? null) })),
    blockers,
    endpoints
  };
}

export default { redactValue, normalizeEndpoint, classifyEndpoint, buildConformanceReport };
