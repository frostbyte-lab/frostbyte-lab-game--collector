import { apiRequest, NativeApiError } from "../api/edu-network-adapter.js";
import { setState, subscribe, updateState } from "./state-store.js";
import { installErrorBoundary } from "./error-boundary.js";
import { installRouter } from "./router.js";
import { announce } from "./accessibility.js";
import { record } from "./telemetry.js";

const requestId = () => globalThis.crypto?.randomUUID?.() || `req-${Date.now()}`;

export async function bootstrap() {
  const loading = document.getElementById("loading-screen");
  const app = document.getElementById("app");
  const reportError = installErrorBoundary({ onError: (entry) => updateState({ lastError: entry, connection: "error" }) });
  const started = performance.now();
  try {
    await apiRequest("POST", "/init", { request_id: requestId(), idempotency_key: requestId() });
    const session = await apiRequest("POST", "/session", { request_id: requestId(), idempotency_key: requestId() });
    const [player, balance] = await Promise.all([apiRequest("GET", "/player"), apiRequest("GET", "/balance")]);
    setState({ player: player.data, balance: balance.data.available_balance, connection: "ready", session: session.data });
    record("bootstrap.ready", { duration_ms: Math.round(performance.now() - started), url: location.href });
    loading?.classList.add("is-hidden"); app?.removeAttribute("aria-busy");
    announce("Native Collector siap digunakan.");
  } catch (error) {
    const entry = reportError(error, "bootstrap");
    setState({ connection: "error", lastError: entry });
    loading?.classList.add("is-hidden"); app?.removeAttribute("aria-busy");
    announce("Native Collector mengalami gangguan. Gunakan tombol coba lagi.");
  }
  installRouter();
  subscribe((state) => {
    document.querySelectorAll("[data-balance]").forEach((element) => { element.textContent = `${state.balance.toLocaleString("id-ID")} pts`; });
    document.querySelectorAll("[data-connection]").forEach((element) => { element.textContent = state.connection === "ready" ? "CONNECTED" : state.connection.toUpperCase(); element.dataset.status = state.connection; });
  });
  document.getElementById("retry-bootstrap")?.addEventListener("click", () => location.reload());
  return { ok: true };
}

export async function runNativeAction(action, input = {}) {
  const started = performance.now();
  try {
    const response = await action({ request_id: requestId(), idempotency_key: requestId(), ...input });
    const nextBalance = response.data?.balance_after ?? response.data?.available_balance;
    updateState({ ...(Number.isFinite(nextBalance) ? { balance: nextBalance } : {}), connection: "ready", lastError: null });
    record("native.action", { duration_ms: Math.round(performance.now() - started), status_code: response.status });
    return response;
  } catch (error) {
    const entry = error instanceof NativeApiError ? record("native.action.error", { error_code: error.error_code, status_code: error.status, message: error.message }) : reportGlobal(error);
    updateState({ connection: "error", lastError: entry });
    throw error;
  }
}

function reportGlobal(error) { return record("native.action.error", { error_code: "INTERNAL_ERROR", status_code: 500, message: String(error?.message || error) }); }
