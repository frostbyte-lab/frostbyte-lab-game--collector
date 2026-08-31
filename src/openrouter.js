const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openrouter/free";
const REQUEST_TIMEOUT_MS = 90000;

export async function openRouterChat(env, messages, options = {}) {
  const apiKey = String(env.OPENROUTER_API_KEY || "");
  if (!apiKey) return { ok: false, status: 503, error: "OPENROUTER_API_KEY belum dikonfigurasi." };
  const baseUrl = String(env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = String(options.model || env.OPENROUTER_MODEL || DEFAULT_MODEL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": String(env.OPENROUTER_SITE_URL || "https://game-resource-collector.workers.dev"),
        "X-OpenRouter-Title": "Game Collector Pro"
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature: options.temperature ?? 0.2,
        max_tokens: Math.min(Number(options.maxTokens || 1600), 2400),
        ...(options.extra || {})
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status, error: payload?.error?.message || "OpenRouter menolak permintaan." };
    const choice = payload?.choices?.[0];
    const message = choice?.message || {};
    const parts = Array.isArray(message.content) ? message.content : [];
    const text = typeof message.content === "string"
      ? message.content
      : parts.filter((part) => part?.type === "text").map((part) => part.text).join("\n");
    return { ok: true, model: payload?.model || model, text: String(text || ""), response: payload };
  } catch (error) {
    return { ok: false, status: error?.name === "AbortError" ? 504 : 502, error: error?.name === "AbortError" ? "OpenRouter timeout." : "OpenRouter tidak dapat dihubungi." };
  } finally {
    clearTimeout(timer);
  }
}

export function openRouterHealth(env) {
  return {
    configured: Boolean(env.OPENROUTER_API_KEY),
    baseUrl: String(env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL),
    model: String(env.OPENROUTER_MODEL || DEFAULT_MODEL)
  };
}
