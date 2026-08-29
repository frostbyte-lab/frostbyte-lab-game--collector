import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

assert.ok(html.includes("protectedCdn = /^(?:static\\.)?eajzzxhro\\.com$/i"));
assert.ok(html.includes("hasSignedAuth = /(?:^|[?&])(sign|signature|token|expires|exp|auth|key)=/i"));
assert.ok(html.includes("SKIP stale protected CDN URL (token tidak ada)"));
assert.ok(html.includes("FAIL protected CDN HTTP"));
assert.ok(html.includes("}, 180000)"));
assert.ok(html.includes("saveTimeout = null"));

console.log("asset repair regression test passed");
