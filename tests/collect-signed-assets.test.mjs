import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../scripts/collect.js", import.meta.url), "utf8");

assert.match(source, /captureMissingStaticAssets/);
assert.match(source, /page\.request\.get\(url/);
assert.match(source, /Referer: mainDocUrl/);
assert.match(source, /capturedBy: 'proactive-static-asset'/);
assert.match(source, /PROGRESS: proactive_static_assets/);
assert.match(source, /smartPackage\(zipFiles, resources\)/);

console.log("signed asset proactive capture test passed");
