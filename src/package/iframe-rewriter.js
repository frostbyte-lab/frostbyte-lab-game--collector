import { assetProxyUrl } from "../lib/asset-proxy.js";

const HTTP_URL = /^https?:\/\//i;
const SAFE_SCHEMES = /^(?:data:|blob:|about:|javascript:|#)/i;

function absoluteUrl(raw, baseUrl) {
  const value = String(raw || "").trim();
  if (!value || SAFE_SCHEMES.test(value)) return null;
  try {
    const resolved = new URL(value, baseUrl);
    return HTTP_URL.test(resolved.href) ? resolved.href : null;
  } catch (_) {
    return null;
  }
}

function proxyUrl(raw, options) {
  const absolute = absoluteUrl(raw, options.baseUrl);
  if (!absolute) return null;
  if (options.localMap?.has(absolute)) return options.localMap.get(absolute);
  if (options.mode === "proxy" || options.mode === "hybrid") {
    return assetProxyUrl(options.proxyOrigin || options.baseUrl, absolute);
  }
  return absolute;
}

/**
 * Rewrite iframe markup without executing page scripts.
 * Relative iframe URLs become absolute; remote frames can be routed through
 * the collector's same-origin proxy, while local manifest paths stay local.
 */
export function rewriteIframeMarkup(html, options = {}) {
  const config = {
    baseUrl: options.baseUrl || "https://local.invalid/",
    proxyOrigin: options.proxyOrigin || "",
    mode: options.mode || "hybrid",
    localMap: options.localMap || new Map()
  };
  let count = 0;
  let out = String(html || "").replace(
    /(<iframe\b[^>]*\bsrc\s*=\s*)(["'])([^"']*)(\2)/gi,
    (match, prefix, quote, raw, closing) => {
      const rewritten = proxyUrl(raw, config);
      if (!rewritten || rewritten === raw) return match;
      count++;
      return `${prefix}${quote}${rewritten}${closing}`;
    }
  );

  // Preserve sandbox safety for generated previews unless explicitly disabled.
  if (options.sandbox !== false) {
    out = out.replace(/<iframe\b([^>]*?)>/gi, (match, attrs) => {
      if (/\bsandbox\s*=/i.test(attrs)) return match;
      return `<iframe${attrs} sandbox="allow-scripts allow-forms allow-same-origin">`;
    });
  }
  return { html: out, rewritten: count };
}

export function rewriteIframeDocument(html, options = {}) {
  const result = rewriteIframeMarkup(html, options);
  const frameBuster = String(result.html).replace(
    /\b(?:top|parent)\.location(?:\.href)?\s*=/gi,
    "/* GC-PRO iframe rewrite: blocked */"
  );
  return { html: frameBuster, rewritten: result.rewritten };
}

export default rewriteIframeMarkup;
