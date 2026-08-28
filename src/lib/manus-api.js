const MANUS_BASE = "https://api.manus.ai/v2";

function jsonError(message, status = 400, code = "MANUS_REQUEST_ERROR") {
  return Response.json({ ok: false, error: code, message: String(message).slice(0, 500) }, { status });
}

function assistantText(messages = []) {
  for (const event of messages) {
    const text = event?.assistant_message?.content;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return "";
}

function latestStatus(messages = []) {
  return [...messages].reverse().find((event) => event?.status_update?.agent_status)?.status_update?.agent_status || null;
}

async function manusFetch(path, apiKey, init = {}) {
  return fetch(MANUS_BASE + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-manus-api-key": apiKey,
      ...(init.headers || {})
    }
  });
}

export async function runManusTask(env, body = {}) {
  // Personal mode: key may arrive from the user's active browser session.
  // Prefer the Worker secret when configured; never log either value.
  const apiKey = String(env.MANUS_API_KEY || body.api_key || "").trim().slice(0, 512);
  if (!apiKey) return jsonError("MANUS_API_KEY belum dikonfigurasi. Isi API key Manus pada sesi personal atau set secret Worker.", 503, "MANUS_NOT_CONFIGURED");
  const prompt = String(body.prompt || body.question || "").trim().slice(0, 18000);
  if (!prompt) return jsonError("Prompt Manus wajib diisi.", 400, "PROMPT_REQUIRED");
  const createBody = {
    message: { content: prompt },
    title: String(body.title || "Custom AI Game Collector").slice(0, 120),
    locale: String(body.locale || "id"),
    interactive_mode: false,
    hide_in_task_list: true,
    share_visibility: "private",
    agent_profile: ["manus-1.6", "manus-1.6-lite", "manus-1.6-max"].includes(body.agent_profile) ? body.agent_profile : "manus-1.6-lite"
  };
  let created;
  try {
    const response = await manusFetch("/task.create", apiKey, { method: "POST", body: JSON.stringify(createBody) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false || !data.task_id) return jsonError(data?.error?.message || data?.message || `Manus task.create HTTP ${response.status}`, response.status >= 400 ? response.status : 502, "MANUS_CREATE_FAILED");
    created = data;
  } catch (error) {
    return jsonError(error?.message || error, 502, "MANUS_NETWORK_ERROR");
  }

  const timeoutMs = Math.min(Math.max(Number(body.timeout_ms || 20000), 5000), 25000);
  const started = Date.now();
  let lastMessages = [];
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await manusFetch(`/task.listMessages?task_id=${encodeURIComponent(created.task_id)}&order=desc&limit=50`, apiKey, { method: "GET" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) return jsonError(data?.error?.message || data?.message || `Manus task.listMessages HTTP ${response.status}`, response.status >= 400 ? response.status : 502, "MANUS_POLL_FAILED");
      lastMessages = Array.isArray(data.messages) ? data.messages : [];
      const text = assistantText(lastMessages);
      const status = latestStatus(lastMessages);
      if (status === "error") return jsonError(lastMessages.find((event) => event?.error_message)?.error_message?.content || "Manus task gagal.", 502, "MANUS_TASK_FAILED");
      if (status === "stopped" && text) return Response.json({ ok: true, provider: "manus", task_id: created.task_id, content: text, model: "manus-1.6-lite", task_url: created.task_url || null });
    } catch (error) {
      return jsonError(error?.message || error, 502, "MANUS_POLL_NETWORK_ERROR");
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return Response.json({ ok: false, provider: "manus", pending: true, task_id: created.task_id, task_url: created.task_url || null, status: latestStatus(lastMessages) || "running", message: "Manus masih memproses task. Gunakan task_id untuk polling lanjutan." }, { status: 202 });
}

export default { runManusTask };
