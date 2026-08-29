import { record } from "./telemetry.js";

export function installErrorBoundary({ onError } = {}) {
  const report = (error, context = "runtime") => {
    const message = error instanceof Error ? error.message : String(error);
    const entry = record("error", { error_code: "INTERNAL_ERROR", context, message });
    onError?.(entry);
    return entry;
  };
  globalThis.addEventListener?.("error", (event) => report(event.error || event.message, "window"));
  globalThis.addEventListener?.("unhandledrejection", (event) => report(event.reason, "promise"));
  return report;
}
