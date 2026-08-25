/**
 * Same-origin asset proxy (tanpa R2) — Hybrid online lebih stabil (CORS / mixed issues).
 * GET /api/asset-proxy?url=https://...
 */

const MAX_PROXY_BYTES = 12 * 1024 * 1024; // 12 MB per request
const FETCH_TIMEOUT_MS = 20000;

function isPrivateHostname(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  // IPv4
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  // IPv6 loopback / link-local rough
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

function parseTargetUrl(raw) {
  if (!raw || typeof raw !== "string") return { error: "url wajib (query ?url=)" };
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  let u;
  try {
    u = new URL(decoded);
  } catch {
    return { error: "url tidak valid" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { error: "hanya http/https" };
  }
  if (isPrivateHostname(u.hostname)) {
    return { error: "host privat/local diblokir" };
  }
  return { url: u };
}

/**
 * @param {Request} request
 * @param {URL} url — request URL
 */
export async function handleAssetProxy(request, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const targetRaw = url.searchParams.get("url") || url.searchParams.get("u");
  const parsed = parseTargetUrl(targetRaw);
  if (parsed.error) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const target = parsed.url;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(target.href, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          request.headers.get("User-Agent") ||
          "Mozilla/5.0 (compatible; GameCollectorPro-AssetProxy/1.0)",
        Accept: request.headers.get("Accept") || "*/*",
        Referer: target.origin + "/"
      }
    });

    if (!upstream.ok) {
      return Response.json(
        {
          error: "upstream " + upstream.status,
          status: upstream.status,
          url: target.href.slice(0, 300)
        },
        { status: 502 }
      );
    }

    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    const cl = upstream.headers.get("content-length");
    if (cl && Number(cl) > MAX_PROXY_BYTES) {
      return Response.json({ error: "file terlalu besar untuk proxy", maxMB: 12 }, { status: 413 });
    }

    const headers = new Headers();
    headers.set("Content-Type", ct);
    headers.set("Cache-Control", "public, max-age=300");
    headers.set("X-GC-Proxy", "1");
    headers.set("X-GC-Proxy-URL", target.href.slice(0, 500));
    // Same-origin for the app; allow embed from our own pages
    headers.set("Access-Control-Allow-Origin", url.origin);
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }

    const buf = new Uint8Array(await upstream.arrayBuffer());
    if (buf.byteLength > MAX_PROXY_BYTES) {
      return Response.json({ error: "file terlalu besar untuk proxy", maxMB: 12 }, { status: 413 });
    }
    headers.set("Content-Length", String(buf.byteLength));
    return new Response(buf, { status: 200, headers });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    const status = /abort/i.test(msg) ? 504 : 502;
    return Response.json(
      { error: "proxy gagal", detail: msg.slice(0, 200), url: target.href.slice(0, 300) },
      { status }
    );
  } finally {
    clearTimeout(timer);
  }
}

export function assetProxyUrl(origin, absoluteUrl) {
  return (
    String(origin || "").replace(/\/+$/, "") +
    "/api/asset-proxy?url=" +
    encodeURIComponent(absoluteUrl)
  );
}
