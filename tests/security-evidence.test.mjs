import assert from "node:assert/strict";
import { detectSecurityEvidence } from "../src/analyze/security-evidence.js";

const report = detectSecurityEvidence({
  texts: ["requestMediaKeySystemAccess('com.widevine.alpha'); new WebSocket('wss://provider.test'); <iframe src='https://demo.test'></iframe>"],
  urls: ["https://static.example.com/reel.png?sign=abc", "https://provider.test/license"],
  requests: [{ url: "https://provider.test/api/spin", headers: { authorization: "secret" } }]
});

const kinds = new Set(report.findings.map((item) => item.kind));
for (const kind of ["drm", "license_server", "iframe_embed", "signed_asset", "realtime"]) assert.ok(kinds.has(kind), `missing ${kind}`);
assert.equal(report.summary.offlineBlocked, true);
assert.equal(report.policy.bypassAttempted, false);
assert.match(report.policy.note, /not bypassed/i);
console.log("security evidence test passed");
