function event(type, init = {}) {
  if (typeof Event === "function" && type !== "message") return new Event(type);
  if (typeof MessageEvent === "function" && type === "message") return new MessageEvent(type, init);
  return { type, ...init };
}

function schedule(fn, delay) {
  return typeof queueMicrotask === "function" && delay === 0 ? queueMicrotask(fn) : setTimeout(fn, delay);
}

export class OfflineWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url, protocols, options = {}) {
    super();
    this.url = String(url);
    this.protocol = Array.isArray(protocols) ? String(protocols[0] || "") : String(protocols || "");
    this.readyState = OfflineWebSocket.CONNECTING;
    this.bufferedAmount = 0;
    this.sent = [];
    this._events = Array.isArray(options.events) ? options.events.slice() : [];
    this._timers = [];
    this._options = options;
    schedule(() => {
      if (this.readyState !== OfflineWebSocket.CONNECTING) return;
      this.readyState = OfflineWebSocket.OPEN;
      this.dispatchEvent(event("open"));
      this._replay();
    }, 0);
  }

  _replay() {
    const interval = Math.max(0, Number(this._options.intervalMs || 0));
    this._events.forEach((item, index) => {
      const timer = schedule(() => {
        if (this.readyState !== OfflineWebSocket.OPEN) return;
        const data = item && typeof item === "object" && "data" in item ? item.data : item;
        this.dispatchEvent(event("message", { data: typeof data === "string" ? data : JSON.stringify(data) }));
      }, interval * (index + 1));
      this._timers.push(timer);
    });
  }

  send(data) {
    if (this.readyState !== OfflineWebSocket.OPEN) throw new Error("INVALID_STATE: WebSocket offline belum OPEN");
    this.sent.push(data);
    if (typeof this._options.onSend === "function") this._options.onSend(data, this);
  }

  close(code = 1000, reason = "offline replay complete") {
    if (this.readyState === OfflineWebSocket.CLOSED) return;
    this.readyState = OfflineWebSocket.CLOSING;
    this._timers.forEach((timer) => clearTimeout(timer));
    this.readyState = OfflineWebSocket.CLOSED;
    this.dispatchEvent(event("close", { code, reason, wasClean: true }));
  }
}

export class OfflineEventSource extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  constructor(url, options = {}) {
    super();
    this.url = String(url);
    this.readyState = OfflineEventSource.CONNECTING;
    this.withCredentials = Boolean(options.withCredentials);
    this._events = Array.isArray(options.events) ? options.events.slice() : [];
    this._timers = [];
    this._options = options;
    schedule(() => {
      if (this.readyState !== OfflineEventSource.CONNECTING) return;
      this.readyState = OfflineEventSource.OPEN;
      this.dispatchEvent(event("open"));
      this._replay();
    }, 0);
  }

  _replay() {
    const interval = Math.max(0, Number(this._options.intervalMs || 0));
    this._events.forEach((item, index) => {
      const timer = schedule(() => {
        if (this.readyState !== OfflineEventSource.OPEN) return;
        const data = item && typeof item === "object" && "data" in item ? item.data : item;
        const payload = typeof data === "string" ? data : JSON.stringify(data);
        const message = event("message", { data: payload, lastEventId: item?.id ? String(item.id) : "" });
        this.dispatchEvent(message);
        if (item && typeof item === "object" && item.type && item.type !== "message") this.dispatchEvent(event(item.type, { data: payload }));
      }, interval * (index + 1));
      this._timers.push(timer);
    });
  }

  close() {
    this._timers.forEach((timer) => clearTimeout(timer));
    this.readyState = OfflineEventSource.CLOSED;
  }
}

export function createReplayPoller({ events = [], intervalMs = 0, onEvent = () => {} } = {}) {
  let index = 0;
  let timer = null;
  let active = false;
  const tick = () => {
    if (!active) return;
    if (index < events.length) onEvent(events[index], index++);
    if (index >= events.length) { active = false; return; }
    timer = setTimeout(tick, Math.max(0, Number(intervalMs)));
  };
  return {
    start() { if (!active) { active = true; tick(); } return this; },
    stop() { active = false; if (timer) clearTimeout(timer); return this; },
    reset() { this.stop(); index = 0; return this; },
    get index() { return index; },
    get active() { return active; }
  };
}

export function installOfflineRealtimeAdapters({ websocketEvents = [], sseEvents = [], intervalMs = 0 } = {}) {
  const previous = { WebSocket: globalThis.WebSocket, EventSource: globalThis.EventSource };
  const WebSocketImpl = class extends OfflineWebSocket {
    constructor(url, protocols) { super(url, protocols, { events: websocketEvents, intervalMs }); }
  };
  const EventSourceImpl = class extends OfflineEventSource {
    constructor(url, options) { super(url, { ...(options || {}), events: sseEvents, intervalMs }); }
  };
  globalThis.WebSocket = WebSocketImpl;
  globalThis.EventSource = EventSourceImpl;
  return {
    WebSocket: WebSocketImpl,
    EventSource: EventSourceImpl,
    restore() {
      if (previous.WebSocket === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = previous.WebSocket;
      if (previous.EventSource === undefined) delete globalThis.EventSource; else globalThis.EventSource = previous.EventSource;
    }
  };
}

export default installOfflineRealtimeAdapters;
