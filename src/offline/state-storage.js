const DEFAULT_STORAGE_KEY = "gc-offline-session-v1";

export function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); }
  };
}

export function getSafeStorage(candidate = undefined) {
  if (candidate && typeof candidate.getItem === "function" && typeof candidate.setItem === "function") return candidate;
  try {
    if (typeof globalThis.localStorage !== "undefined") return globalThis.localStorage;
  } catch (_) {}
  return createMemoryStorage();
}

export function saveSessionState(storage, state, key = DEFAULT_STORAGE_KEY) {
  const target = getSafeStorage(storage);
  const safeState = JSON.parse(JSON.stringify(state));
  delete safeState.token;
  target.setItem(key, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), state: safeState }));
  return safeState;
}

export function loadSessionState(storage, key = DEFAULT_STORAGE_KEY) {
  const target = getSafeStorage(storage);
  const raw = target.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.version === 1 && parsed.state ? parsed.state : null;
  } catch (_) {
    return null;
  }
}

export function clearSessionState(storage, key = DEFAULT_STORAGE_KEY) {
  getSafeStorage(storage).removeItem(key);
}

export { DEFAULT_STORAGE_KEY };
