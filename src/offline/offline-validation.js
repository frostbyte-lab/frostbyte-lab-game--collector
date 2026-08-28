import { createLocalApiRouter } from "./api-router.js";

const DEFAULT_API_MAP = {
  endpoints: [
    { pathLower: "/verifysession", kind: "session", status: 200 },
    { pathLower: "/gameinfo", kind: "init", status: 200 },
    { pathLower: "/gamewallet", kind: "balance", status: 200 },
    { pathLower: "/spin", kind: "spin", status: 200 }
  ]
};

async function readJson(response) {
  return response ? response.json().catch(() => null) : null;
}

export async function validateOfflineGameplay({ emulator, apiMap = DEFAULT_API_MAP, baseUrl = "https://game.offline.local", bet = 100 } = {}) {
  if (!emulator || typeof emulator.handle !== "function") throw new TypeError("emulator.handle wajib tersedia");
  const router = createLocalApiRouter({ emulator, apiMap, mode: "offline" });
  let networkAttempts = 0;
  const failures = [];
  const fetchOffline = async (path, init) => {
    const response = await router.handle(`${baseUrl}${path}`, init);
    if (response) return response;
    networkAttempts++;
    return new Response(JSON.stringify({ ok: false, offline: true, error: "NETWORK_BLOCKED" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "X-GC-Offline": "1" }
    });
  };
  const check = async (name, path, init, predicate) => {
    const response = await fetchOffline(path, init);
    const body = await readJson(response);
    if (!response.ok || !predicate(body)) failures.push({ step: name, status: response.status, body });
    return { name, status: response.status, body };
  };

  const session = await check("session", "/verifysession", undefined, (body) => Boolean(body?.sessionId && body?.token));
  const init = await check("init", "/gameinfo", undefined, (body) => body?.balance === emulator.snapshot().balance);
  const before = await check("balance-before", "/gamewallet", undefined, (body) => body?.balance === emulator.snapshot().balance);
  const spin = await check("spin", "/spin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bet })
  }, (body) => Boolean(body?.data?.roundId && typeof body?.data?.balance === "number"));
  const after = await check("balance-after", "/gamewallet", undefined, (body) => body?.round === 1 && body?.balance === emulator.snapshot().balance);
  const state = emulator.snapshot();
  const arithmetic = spin.body?.data
    ? spin.body.data.balance === spin.body.data.balanceBefore - spin.body.data.charged + spin.body.data.winAmount
    : false;
  if (!arithmetic) failures.push({ step: "balance-arithmetic", reason: "balanceBefore - charged + winAmount tidak cocok" });
  if (networkAttempts > 0) failures.push({ step: "network-isolation", reason: `${networkAttempts} request lolos ke fallback network` });
  return {
    version: 1,
    status: failures.length === 0 ? "FULL_OFFLINE_READY" : "NOT_READY",
    gameplayReady: failures.length === 0,
    networkIsolated: networkAttempts === 0,
    networkAttempts,
    steps: [session, init, before, spin, after],
    state: { sessionId: state.sessionId, round: state.round, balance: state.balance, history: state.history.length },
    failures
  };
}

export function assertOfflineReady(report) {
  if (!report?.gameplayReady) {
    throw new Error(`Offline gameplay validation gagal: ${JSON.stringify(report?.failures || [])}`);
  }
  return report;
}

export { DEFAULT_API_MAP };
export default validateOfflineGameplay;
