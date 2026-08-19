const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

    function clean(value, max = 18000) {
    if (value == null) return "";
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.slice(0, max);
    }

    function extractJson(text) {
    const raw = String(text || "").trim();
    try { return JSON.parse(raw); } catch {}
    const match = raw.match(/\\{[\\s\\S]*\\}/);
    if (match) { try { return JSON.parse(match[0]); } catch {} }
    return { answer: raw };
    }

    export async function askAI(env, system, user, options = {}) {
    if (!env.AI || typeof env.AI.run !== "function") throw new Error("Cloudflare Workers AI belum tersedia");
    const response = await env.AI.run(options.model || env.AI_MODEL || MODEL, {
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: Math.min(Number(options.max_tokens || 1200), 2400),
      temperature: options.temperature ?? 0.2
    });
    return response?.response || response?.result?.response || JSON.stringify(response);
    }

    const SYSTEM = "Anda adalah asisten AI untuk Game Collector Pro. Fokus pada metadata game web yang legal dikoleksi. Jangan mengarang URL atau fakta yang tidak ada. Jawab dalam Bahasa Indonesia. Jika diminta JSON, keluarkan JSON valid tanpa markdown.";

    export async function analyzeGame(env, payload) {
    const prompt = "Analisis data game berikut dan kembalikan JSON dengan field: title, genre (array), platform (array), engine, confidence (0-1), summary, tags (array), missingMetadata (array), qualityScore (0-100). DATA: " + clean(payload);
    return extractJson(await askAI(env, SYSTEM, prompt, { max_tokens: 1400 }));
    }

    export async function repairMetadata(env, payload) {
    const prompt = "Perbaiki metadata game berikut. Pertahankan fakta yang sudah ada, isi hanya yang dapat disimpulkan dengan jelas, dan tandai asumsi. Kembalikan JSON dengan field repaired, changes, warnings. METADATA: " + clean(payload);
    return extractJson(await askAI(env, SYSTEM, prompt, { max_tokens: 1200 }));
    }

    export async function recommendGames(env, payload) {
    const prompt = "Buat rekomendasi dari katalog game berikut. Kembalikan JSON dengan recommendations dan explanation. Jangan membuat judul yang tidak ada dalam katalog. KATALOG: " + clean(payload, 22000);
    return extractJson(await askAI(env, SYSTEM, prompt, { max_tokens: 1400 }));
    }

    export async function chatAboutGames(env, question, context) {
    const prompt = "Jawab pertanyaan pengguna berdasarkan konteks koleksi berikut. Jika konteks tidak cukup, katakan terus terang. KONTEKS: " + clean(context, 14000) + " PERTANYAAN: " + clean(question, 3000);
    return askAI(env, SYSTEM, prompt, { max_tokens: 1200 });
    }
    