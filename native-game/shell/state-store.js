const STORAGE_KEY = "frostbyte.native-game.state.v1";

const defaultState = {
  route: "dashboard",
  connection: "ready",
  player: { player_id: "demo-player", display_name: "Demo Operator", status: "active" },
  balance: 1250,
  validation: { status: "READY", score: 96, checks: [] },
  history: [],
  activity: [],
  lastError: null
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadPersisted() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? { ...clone(defaultState), ...JSON.parse(raw) } : clone(defaultState);
  } catch {
    return clone(defaultState);
  }
}

let state = loadPersisted();
const listeners = new Set();

function persist() {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage is optional */ }
}

export function getState() { return clone(state); }

export function setState(patch) {
  state = { ...state, ...clone(patch) };
  persist();
  listeners.forEach((listener) => listener(getState()));
  return getState();
}

export function updateState(updater) {
  return setState(typeof updater === "function" ? updater(getState()) : updater);
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(getState());
  return () => listeners.delete(listener);
}

export function resetState() {
  state = clone(defaultState);
  persist();
  listeners.forEach((listener) => listener(getState()));
}
