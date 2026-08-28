function safeUrl(value) {
  try { return new URL(String(value), globalThis.location?.href || "https://runtime.local/").href; } catch (_) { return String(value || ""); }
}

function makeRecord(kind, url, extra = {}) {
  return { kind, url: safeUrl(url), capturedAt: new Date().toISOString(), ...extra };
}

export function createRuntimeDependencyInterceptor({ onResource = () => {}, mode = "observe" } = {}) {
  const records = [];
  const original = {
    fetch: globalThis.fetch,
    XHR: globalThis.XMLHttpRequest,
    WebSocket: globalThis.WebSocket,
    EventSource: globalThis.EventSource,
    createObjectURL: globalThis.URL?.createObjectURL
  };
  const emit = (record) => {
    records.push(record);
    try { onResource(record); } catch (_) {}
    return record;
  };
  const blocked = (url) => new Response(JSON.stringify({ ok: false, offline: true, error: "RUNTIME_NETWORK_BLOCKED", url: safeUrl(url) }), {
    status: 503,
    headers: { "Content-Type": "application/json", "X-GC-Offline": "1" }
  });
  const shouldBlock = (url) => mode === "offline" && /^https?:/i.test(safeUrl(url)) && !/localhost|127\.0\.0\.1|\.offline\.local/i.test(safeUrl(url));

  function install() {
    if (typeof original.fetch === "function") {
      globalThis.fetch = async (input, init) => {
        const url = input?.url || input;
        const method = init?.method || input?.method || "GET";
        emit(makeRecord("fetch", url, { method: String(method).toUpperCase(), phase: "request" }));
        if (shouldBlock(url)) return blocked(url);
        const response = await original.fetch.call(globalThis, input, init);
        emit(makeRecord("fetch", url, { method: String(method).toUpperCase(), status: response.status, phase: "response" }));
        return response;
      };
    }
    if (original.XHR) {
      const NativeXHR = original.XHR;
      globalThis.XMLHttpRequest = class extends NativeXHR {
        open(method, url, ...rest) {
          this.__gcRuntime = emit(makeRecord("xhr", url, { method: String(method).toUpperCase(), phase: "open" }));
          return super.open(method, url, ...rest);
        }
        send(body) {
          if (this.__gcRuntime) this.__gcRuntime.requestBodyPresent = body != null && String(body).length > 0;
          if (this.__gcRuntime) this.__gcRuntime.phase = "request";
          return super.send(body);
        }
      };
    }
    if (original.WebSocket) {
      const NativeWebSocket = original.WebSocket;
      globalThis.WebSocket = class extends NativeWebSocket {
        constructor(url, protocols) {
          emit(makeRecord("websocket", url, { protocols: Array.isArray(protocols) ? protocols : protocols ? [protocols] : [] }));
          super(url, protocols);
        }
      };
    }
    if (original.EventSource) {
      const NativeEventSource = original.EventSource;
      globalThis.EventSource = class extends NativeEventSource {
        constructor(url, options) {
          emit(makeRecord("eventsource", url, { withCredentials: Boolean(options?.withCredentials) }));
          super(url, options);
        }
      };
    }
    if (original.createObjectURL && globalThis.URL) {
      globalThis.URL.createObjectURL = (object) => {
        const url = original.createObjectURL.call(globalThis.URL, object);
        emit(makeRecord("blob", url, { sourceType: object?.type || typeof object, size: Number(object?.size || 0) }));
        return url;
      };
    }
    return this;
  }

  function restore() {
    if (original.fetch) globalThis.fetch = original.fetch;
    if (original.XHR) globalThis.XMLHttpRequest = original.XHR;
    if (original.WebSocket) globalThis.WebSocket = original.WebSocket;
    if (original.EventSource) globalThis.EventSource = original.EventSource;
    if (original.createObjectURL && globalThis.URL) globalThis.URL.createObjectURL = original.createObjectURL;
  }

  return {
    install,
    restore,
    records,
    clear() { records.length = 0; },
    snapshot() { return records.map((record) => ({ ...record })); },
    trackImport(specifier) { return emit(makeRecord("dynamic-import", specifier, { phase: "request" })); }
  };
}

export async function trackedImport(specifier, interceptor, importer = (value) => import(value)) {
  interceptor?.trackImport?.(specifier);
  return importer(specifier);
}

export default createRuntimeDependencyInterceptor;
