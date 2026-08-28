import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { rewriteIframeMarkup } from "../src/package/iframe-rewriter.js";
import { FILL_MISSING_V2_MAX_PER_PASS } from "../src/collect/fill-missing-enhanced.js";

const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

assert.match(sw, /const SHELL = "gc-pro-shell-v9"/);
assert.match(sw, /const VENDOR_CACHE = "gc-pro-vendor-v1"/);
assert.match(sw, /const ZIP_CACHE = "gc-pro-zip-v5"/);
assert.match(sw, /PUT_VENDOR_ASSETS/);
assert.match(sw, /url\.pathname\.startsWith\("\/vendor\/"\)/);
assert.match(sw, /url\.pathname\.startsWith\("\/__gc__\/"\)/);
assert.match(sw, /Offline mode: request API diblokir/);
assert.match(sw, /X-GC-Offline/);
assert.equal(FILL_MISSING_V2_MAX_PER_PASS, 250);
const rewritten = rewriteIframeMarkup('<iframe src="https://cdn.example.test/game/index.html"></iframe>', {
  baseUrl: "https://collector.example.test/",
  proxyOrigin: "https://collector.example.test",
  mode: "proxy"
});
assert.equal(rewritten.rewritten, 1);
assert.match(rewritten.html, /\/api\/asset-proxy\?url=/);
assert.match(rewritten.html, /sandbox=/);

console.log("offline SW smoke test passed");
