import assert from "node:assert/strict";
import { getMasterToolsetReport, MASTER_TOOLSET } from "../src/tools/master-toolset.js";

assert.equal(MASTER_TOOLSET.length, 50);
assert.equal(new Set(MASTER_TOOLSET.map((tool) => tool.id)).size, 50);
const report = getMasterToolsetReport();
assert.equal(report.totalRequested, 50);
assert.equal(report.summary.total, 50);
assert.ok(report.summary.active > 0);
assert.ok(report.summary.partial > 0);
assert.ok(report.summary.external > 0);
assert.equal(report.policy.authorizedResearchRequired, true);
assert.equal(report.policy.bypassControls, false);
console.log("master toolset test passed");
