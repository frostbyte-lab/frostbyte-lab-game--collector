/**
 * Same-origin asset proxy (tanpa R2) — Hybrid online lebih stabil (CORS / mixed issues).
 * GET /api/asset-proxy?url=https://...
 *
 * Security invariants:
 * - only public HTTP(S) targets
 * - no credentials in URLs
 * - redirects are manual and revalidated on every hop
 * - response size and content type are bounded
 */

const MAX_PROXY_BYTES = 12 * 1024 * 1024; // 12 MB per request
const FETCH_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 3;
const ALLOWED_CONTENT_TYPES = /^(image|audio|video|font)\//i;

function isPrivateHostname(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  // IPv4 literals, including the full RFC1918, loopback, link-local and documentation ranges.
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const octets = m.slice(1).map(Number);
    if (octets.some((n) => n > 255)) return true;
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0) || a >= 224;
  }
  // IPv6 loopback, unspecified, link-local, unique-local and IPv4-mapped forms.
  const compact = h.replace(/^\[|\]$/g, "");
  if (compact === "::" || compact === "::1" || compact.startsWith("fc") || compact.startsWith("fd") || compact.startsWith("fe8") || compact.startsWith("fe9") || compact.startsWith("fea") || compact.startsWith("feb")) return true;
  const mapped = compact.match(/^(?:0*:){0,4}ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped && isPrivateHostname(mapped[1])) return true;
  return false;
}

function parseTargetUrl(raw) {
  if (!raw || typeof raw !== "string") return { error: "url wajib (query ?url=)" };
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* keep raw */ }
  let u;
  try { u = new URL(decoded); } catch { return { error: "url tidak valid" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { error: "hanya http/https" };
  if (u.username || u.password || isPrivateHostname(u.hostname)) return { error: "host privat/local atau credential diblokir" };
  return { url: u };
}

export { isPrivateHostname, parseTargetUrl };

export async function handleAssetProxy(request, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return Response.json({ error: "method not allowed" }, { status: 405 });
  const targetRaw = url.searchParams.get("url") || url.searchParams.get("u");
  const parsed = parseTargetUrl(targetRaw);
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 });
  let target = parsed.url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let upstream;
    let redirectCount = 0;
    while (true) {
      const host = String(target.hostname || "").toLowerCase();
      const isPgSoftCdn = /pgsoft|pg-soft|eajzzxhro|static\.[a-z0-9-]+\.(com|net|io)/i.test(host) || /[?&]sign=/i.test(target.href);
      let pgOrigin = "https://m.pgsoft-games.com";
      if (/eajzzxhro\.com/i.test(host)) pgOrigin = "https://m.eajzzxhro.com";
      else if (/^static\./i.test(host)) pgOrigin = "https://m." + host.replace(/^static\./i, "");
      const clientRef = request.headers.get("X-GC-Referer");
      const referer = (clientRef && /^https?:\/\/[^\s]+$/i.test(clientRef) ? clientRef : null) || (isPgSoftCdn ? pgOrigin + "/" : null) || target.origin + "/";
      upstream = await fetch(target.href, {
        method: request.method === "HEAD" ? "HEAD" : "GET",
        redirect: "manual", signal: controller.signal,
        headers: {
          "User-Agent": isPgSoftCdn ? "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Safari/537.36" : "GameCollectorProxy/2.0",
          Accept: request.headers.get("Accept") || "image/avif,image/webp,image/apng,image/png,image/*,audio/*,video/*,font/*;q=0.8",
          Referer: referer, Origin: isPgSoftCdn ? pgOrigin : target.origin
        }
      });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      if (redirectCount++ >= MAX_REDIRECTS) return Response.json({ error: "terlalu banyak redirect" }, { status: 502 });
      const location = upstream.headers.get("location");
      const next = location ? new URL(location, target.href) : null;
      const nextParsed = next ? parseTargetUrl(next.href) : { error: "redirect tanpa lokasi" };
      if (nextParsed.error) return Response.json({ error: "redirect ke host tidak diizinkan" }, { status: 502 });
      target = nextParsed.url;
    }
    if (!upstream.ok) return Response.json({ error: "upstream " + upstream.status, status: upstream.status, url: target.origin + target.pathname }, { status: 502 });
    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    if (!ALLOWED_CONTENT_TYPES.test(ct)) return Response.json({ error: "content type tidak diizinkan" }, { status: 415 });
    const cl = upstream.headers.get("content-length");
    if (cl && (!Number.isFinite(Number(cl)) || Number(cl) > MAX_PROXY_BYTES)) return Response.json({ error: "file terlalu besar untuk proxy", maxMB: 12 }, { status: 413 });
    const headers = new Headers({ "Content-Type": ct, "Cache-Control": "public, max-age=300", "X-GC-Proxy": "1", "X-GC-Proxy-URL": target.origin + target.pathname, "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" });
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    const buf = new Uint8Array(await upstream.arrayBuffer());
    if (buf.byteLength > MAX_PROXY_BYTES) return Response.json({ error: "file terlalu besar untuk proxy", maxMB: 12 }, { status: 413 });
    headers.set("Content-Length", String(buf.byteLength));
    return new Response(buf, { status: 200, headers });
  } catch (e) {
    const msg = String(e?.message || e);
    return Response.json({ error: "proxy gagal", detail: msg.slice(0, 200) }, { status: /abort/i.test(msg) ? 504 : 502 });
  } finally { clearTimeout(timer); }
}

export function assetProxyUrl(origin, absoluteUrl) {
  return String(origin || "").replace(/\/+$/, "") + "/api/asset-proxy?url=" + encodeURIComponent(absoluteUrl);
}
