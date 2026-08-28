import { resolveMockFromApiMap } from "../package/api-map.js";

function errorResponse(url, reason = "UNKNOWN_API_ROUTE") {
  return new Response(JSON.stringify({
    ok: false,
    offline: true,
    __gcMock: true,
    error: reason,
    message: "Route API belum terdaftar pada api-map.json dan diblokir dalam mode offline.",
    url: String(url)
  }), {
    status: 503,
    headers: { "Content-Type": "application/json", "X-GC-Offline": "1", "X-GC-Mock": "stateful-router-v1" }
  });
}

function localRoute(kind) {
  if (kind === "session" || kind === "auth") return "/verifysession";
  if (kind === "init" || kind === "launch") return "/gameinfo";
  if (kind === "balance") return "/gamewallet";
  if (kind === "spin" || kind === "spin-request" || kind === "spin-result") return "/spin";
  return null;
}

function matchingEndpoint(apiMap, requestUrl) {
  if (!apiMap?.endpoints?.length) return null;
  let path = "";
  try { path = new URL(requestUrl, "https://gc.offline.local/").pathname.toLowerCase(); } catch (_) { path = String(requestUrl).toLowerCase(); }
  return apiMap.endpoints
    .filter((entry) => entry?.pathLower)
    .sort((a, b) => String(b.pathLower).length - String(a.pathLower).length)
    .find((entry) => path === entry.pathLower || path.includes(entry.pathLower) || path.includes(String(entry.pathLower).split("/").filter(Boolean).pop() || "")) || null;
}

export function createLocalApiRouter({ emulator, apiMap = null, mode = "offline" } = {}) {
  if (!emulator || typeof emulator.handle !== "function") throw new TypeError("emulator.handle wajib tersedia");
  const policy = mode === "hybrid" ? "hybrid" : "offline";

  async function handle(requestOrUrl, init = {}) {
    const request = requestOrUrl instanceof Request ? requestOrUrl : new Request(requestOrUrl, init);
    const endpoint = matchingEndpoint(apiMap, request.url);
    const resolved = endpoint ? resolveMockFromApiMap(apiMap, request.url) : null;
    const kind = endpoint?.kind || resolved?.kind;
    const route = localRoute(kind);

    if (route) {
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.clone().arrayBuffer();
      return emulator.handle(`https://gc.offline.local${route}`, {
        method: request.method,
        headers: request.headers,
        body: body && body.byteLength ? body : undefined
      });
    }

    if (resolved?.body && endpoint?.hasSnapshot) {
      return new Response(JSON.stringify(resolved.body), {
        status: endpoint.status || 200,
        headers: { "Content-Type": "application/json", "X-GC-Snapshot": "1" }
      });
    }
    if (policy === "offline") return errorResponse(request.url);
    return null;
  }

  return { handle, mode: policy, resolve: (url) => matchingEndpoint(apiMap, url) };
}

export function installLocalApiRouter({ emulator, apiMap, mode = "offline" } = {}) {
  const router = createLocalApiRouter({ emulator, apiMap, mode });
  const originalFetch = globalThis.fetch?.bind(globalThis);
  if (!originalFetch) throw new Error("fetch tidak tersedia pada runtime lokal");
  globalThis.fetch = async (input, init) => {
    const response = await router.handle(input, init);
    return response || originalFetch(input, init);
  };
  return { router, restore() { globalThis.fetch = originalFetch; } };
}

export { localRoute, matchingEndpoint };
export default createLocalApiRouter;
