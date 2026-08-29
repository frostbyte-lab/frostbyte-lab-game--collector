import test from "node:test";
import assert from "node:assert/strict";
import { aggregateHistoryMetrics } from "../src/observability/metrics.js";

test("aggregateHistoryMetrics summarizes history without exposing URLs", () => {
  const report = aggregateHistoryMetrics([
    { status: "ok", files: 10, zipSize: 1000, overallScore: 80, details: { engine: "phaser" }, url: "https://secret.example/game?token=secret" },
    { status: "blocked", files: 0, zipSize: 0, details: { engine: "unknown" } },
    { status: "resume_partial", files: 4, zipSize: 400, overallScore: 60, engine: "unity" }
  ]);

  assert.equal(report.sampleSize, 3);
  assert.equal(report.success, 1);
  assert.equal(report.failure, 1);
  assert.equal(report.partial, 1);
  assert.equal(report.successRate, 33.3);
  assert.equal(report.totalFiles, 14);
  assert.equal(report.totalZipBytes, 1400);
  assert.equal(report.averageOverallScore, 70);
  assert.deepEqual(report.byEngine, { phaser: 1, unknown: 1, unity: 1 });
  assert.equal("url" in report, false);
});
