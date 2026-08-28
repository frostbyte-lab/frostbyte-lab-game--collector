import assert from "node:assert/strict";
import { OfflineWebSocket, OfflineEventSource, createReplayPoller, installOfflineRealtimeAdapters } from "../src/offline/realtime-adapter.js";

const wsMessages = [];
const ws = new OfflineWebSocket("wss://provider.example.test/events", undefined, { events: [{ data: { type: "spin-result", win: 20 } }] });
ws.addEventListener("message", (event) => wsMessages.push(JSON.parse(event.data)));
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(ws.readyState, OfflineWebSocket.OPEN);
assert.deepEqual(wsMessages, [{ type: "spin-result", win: 20 }]);
ws.send("ping");
assert.deepEqual(ws.sent, ["ping"]);
ws.close();
assert.equal(ws.readyState, OfflineWebSocket.CLOSED);

const sseMessages = [];
const source = new OfflineEventSource("https://provider.example.test/sse", { events: [{ id: 1, data: { balance: 900 } }] });
source.addEventListener("message", (event) => sseMessages.push(JSON.parse(event.data)));
await new Promise((resolve) => setTimeout(resolve, 5));
assert.deepEqual(sseMessages, [{ balance: 900 }]);
source.close();

const polled = [];
const poller = createReplayPoller({ events: ["a", "b"], onEvent: (value) => polled.push(value) });
poller.start();
await new Promise((resolve) => setTimeout(resolve, 5));
assert.deepEqual(polled, ["a", "b"]);
assert.equal(poller.active, false);

const previousWs = globalThis.WebSocket;
const installed = installOfflineRealtimeAdapters({ websocketEvents: [{ data: "ok" }] });
assert.notEqual(globalThis.WebSocket, previousWs);
installed.restore();
assert.equal(globalThis.WebSocket, previousWs);
console.log("realtime adapter test passed");
