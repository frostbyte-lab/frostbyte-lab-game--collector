const MAX_HTML_BYTES = 1_200_000;
const MAX_URL_LENGTH = 2_000;
const PRIVATE_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/i;
const BLOCKED_HOST_RE = /(^|\.)((?:internal|intranet|admin|localhost|local))$/i;

function fail(code, message, status = 400) {
  return Response.json({ ok: false, error: code, message }, { status, headers: { "Cache-Control": "no-store" } });
}

function publicUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    const host = url.hostname.toLowerCase();
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || PRIVATE_HOST_RE.test(host) || BLOCKED_HOST_RE.test(host) || host.includes(":")) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function cleanText(value, max = 400) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function firstMatch(text, patterns, fallback = null) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match?.[1]) return cleanText(decodeEntities(match[1]), 160);
  }
  return fallback;
}

function absoluteUrl(raw, base) {
  try { return new URL(decodeEntities(raw), base).toString(); } catch { return null; }
}

export function extractPublicMetadata(html, sourceUrl, fetchedAt = new Date().toISOString()) {
  const raw = String(html || "");
  const title = firstMatch(raw, [/<title[^>]*>([\s\S]*?)<\/title>/i, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i]);
  const description = firstMatch(raw, [/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i], "");
  const imageRaw = firstMatch(raw, [/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i, /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i]);
  const text = cleanText(raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "), 10000);
  const provider = firstMatch(text, [/(?:slot\s+by|provider|developer)\s*[:\-]?\s*(PG\s*Soft|Pragmatic\s*Play|[^|,.]{2,40})/i, /\b(PG\s*Soft)\b/i]);
  const rtp = firstMatch(text, [/\b(RTP\s*[:\-]?\s*\d{2,3}(?:\.\d+)?\s*%)/i, /(\d{2,3}(?:\.\d+)?\s*%\s*RTP)/i]);
  const volatility = firstMatch(text, [/\b(Volatility\s*[:\-]?\s*(?:Low|Medium|High|[^|,.]{2,20}))/i, /\b(Low|Medium|High)\s+volatility\b/i]);
  const maxWin = firstMatch(text, [/\b(Max(?:imum)?\s*Win\s*[:\-]?\s*x?\s*[\d,.]+)/i, /(x\s*[\d,.]+\s*(?:max win|potential))/i]);
  const betways = firstMatch(text, [/\b(Betways\s*[:\-]?\s*[\d,]+)/i, /(\d{1,3}(?:,\d{3})+\s+win\s+ways)/i]);
  const embedLabel = /integrate\s+(?:the\s+)?demo\s+game|integrate\s+demo\s+game/i;
  const embedLinks = [];
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of raw.matchAll(anchorRe)) {
    if (embedLabel.test(cleanText(match[2], 200))) {
      const href = absoluteUrl(match[1], sourceUrl);
      if (href) embedLinks.push(href);
    }
  }
  return {
    title: title || sourceUrl,
    description,
    provider,
    rtp,
    volatility,
    max_win: maxWin,
    betways,
    image_url: imageRaw ? absoluteUrl(imageRaw, sourceUrl) : null,
    official_integration_url: embedLinks[0] || null,
    source_url: sourceUrl,
    fetched_at: fetchedAt,
    extraction: "public-html-only",
    protected_runtime: "not collected"
  };
}

async function readLimited(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return (await response.text()).slice(0, MAX_HTML_BYTES);
  const chunks = [];
  let total = 0;
  while (total < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    const next = value.slice(0, MAX_HTML_BYTES - total);
    chunks.push(next); total += next.byteLength;
    if (next.byteLength < value.byteLength) break;
  }
  return new TextDecoder().decode(Uint8Array.from(chunks.flatMap((chunk) => [...chunk])));
}

export async function fetchPublicMetadata(rawUrl, options = {}) {
  const target = publicUrl(rawUrl);
  if (!target || String(rawUrl || "").length > MAX_URL_LENGTH) return { ok: false, error: "PUBLIC_URL_INVALID", message: "URL harus berupa halaman HTTP(S) publik tanpa credential atau host private." };
  try {
    const response = await fetch(target, { redirect: "follow", headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "GameCollectorPro-PublicMetadata/1.0" } });
    const finalUrl = publicUrl(response.url) || target;
    if (!response.ok) return { ok: false, error: "PUBLIC_PAGE_UNAVAILABLE", message: `Halaman publik mengembalikan HTTP ${response.status}.`, status: response.status, source_url: target.toString() };
    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) return { ok: false, error: "PUBLIC_HTML_REQUIRED", message: "Target bukan dokumen HTML publik.", status: 415, source_url: finalUrl.toString() };
    const html = await readLimited(response);
    const metadata = extractPublicMetadata(html, finalUrl.toString());
    return { ok: true, data: metadata, bytes_scanned: html.length, official_embed_available: Boolean(metadata.official_integration_url), note: "Metadata publik saja. Runtime game, iframe asset, token, cookie, signed request, dan DRM tidak dikoleksi." };
  } catch (error) {
    return { ok: false, error: "PUBLIC_FETCH_FAILED", message: String(error?.message || error).slice(0, 240) };
  }
}

export async function handlePublicMetadata(request) {
  let body;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Body JSON tidak valid."); }
  if (request.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Gunakan POST.", 405);
  const result = await fetchPublicMetadata(body?.url);
  return Response.json(result, { status: result.ok ? 200 : (result.status || 422), headers: { "Cache-Control": "no-store", "X-GC-Public-Metadata": "1" } });
}

export async function handleOfficialEmbed(request) {
  let body;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Body JSON tidak valid."); }
  if (request.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Gunakan POST.", 405);
  const result = await fetchPublicMetadata(body?.url);
  if (!result.ok) return Response.json(result, { status: result.status || 422 });
  const source = new URL(result.data.source_url);
  const integration = result.data.official_integration_url ? new URL(result.data.official_integration_url) : null;
  const sameSite = integration && integration.hostname === source.hostname;
  return Response.json({ ok: true, mode: sameSite ? "official-link" : "manual-official-integration", source_url: source.toString(), official_integration_url: sameSite ? integration.toString() : null, requires_user_confirmation: true, allowed_in_frame: false, message: sameSite ? "Link integrasi resmi ditemukan. Buka link tersebut untuk mendapatkan embed sesuai izin provider." : "Gunakan tombol Integrate demo game di halaman sumber dan tempel kode resmi yang Anda miliki; collector tidak mengambil iframe runtime otomatis.", metadata: result.data }, { headers: { "Cache-Control": "no-store", "X-GC-Official-Embed": "1" } });
}

export { publicUrl };
