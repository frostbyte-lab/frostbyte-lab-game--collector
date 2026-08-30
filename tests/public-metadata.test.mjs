import test from "node:test";
import assert from "node:assert/strict";
import { extractPublicMetadata, publicUrl } from "../src/public-metadata.js";

test("extracts public Cruise Royale metadata and official integration link", () => {
  const html = `<!doctype html><html><head><title>Cruise Royale Slot</title><meta name="description" content="PG Soft review"><meta property="og:image" content="/images/cruise.png"></head><body><p>Slot By PG Soft. RTP 96.63%. Low volatility. Max Win x2500.00. 10,000 win ways.</p><a href="/integrate/cruise-royale">Integrate demo game</a></body></html>`;
  const data = extractPublicMetadata(html, "https://slotcatalog.com/en/slots/Cruise-Royale");
  assert.equal(data.title, "Cruise Royale Slot");
  assert.equal(data.provider, "PG Soft");
  assert.match(data.rtp, /96\.63/);
  assert.equal(data.image_url, "https://slotcatalog.com/images/cruise.png");
  assert.equal(data.official_integration_url, "https://slotcatalog.com/integrate/cruise-royale");
  assert.equal(data.extraction, "public-html-only");
  assert.equal(data.protected_runtime, "not collected");
});

test("rejects private, credentialed, and non-http URLs", () => {
  assert.equal(publicUrl("http://127.0.0.1:8787/game"), null);
  assert.equal(publicUrl("https://user:pass@example.com/game"), null);
  assert.equal(publicUrl("ftp://example.com/game"), null);
  assert.equal(publicUrl("https://slotcatalog.com/en/slots/Cruise-Royale")?.toString(), "https://slotcatalog.com/en/slots/Cruise-Royale");
});
