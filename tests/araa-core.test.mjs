import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAraaEvidence, ARAA_IDENTITY, redactAraaEvidence } from '../src/araa-core.js';
import { ARAA_CASE_DATASET, ARAA_DATASET_VERSION, matchAraaDataset } from '../src/araa-dataset.js';

test('A Core Raa is standalone and exposes identity', () => {
  assert.equal(ARAA_IDENTITY.name, 'A Core Raa');
  assert.equal(ARAA_IDENTITY.externalAI, false);
  const result = analyzeAraaEvidence({ manifest: { files: ['index.html'] }, files: ['index.html'], integrity: true, dependencyGraph: {} });
  assert.equal(result.mode, 'standalone');
  assert.ok(result.score >= 0 && result.score <= 100);
});

test('A Core Raa redacts secret evidence', () => {
  const clean = redactAraaEvidence({ authorization: 'secret', nested: { apiKey: 'hidden', ok: 'visible' } });
  assert.equal(clean.authorization, '[redacted]');
  assert.equal(clean.nested.apiKey, '[redacted]');
  assert.equal(clean.nested.ok, 'visible');
});

test('local dataset covers broad game-web failure modes', () => {
  assert.ok(ARAA_CASE_DATASET.length >= 20);
  assert.equal(typeof ARAA_DATASET_VERSION, 'string');
  const matches = matchAraaDataset(['G1006', 'service worker', 'websocket', 'integrity mismatch', 'captcha']);
  assert.ok(matches.some((item) => item.id === 'URL-G1006'));
  assert.ok(matches.some((item) => item.id === 'CACHE-SW'));
  assert.ok(matches.some((item) => item.id === 'API-WEBSOCKET'));
  assert.ok(matches.some((item) => item.id === 'CAPTURE-BOT-GATE'));
});

test('analysis reports dataset version and matched patterns', () => {
  const result = analyzeAraaEvidence({ errors: ['G1006'], api: ['wss://example.test'], security: { protectedResources: ['license'] } });
  assert.equal(result.dataset.caseCount >= 20, true);
  assert.equal(result.dataset.version, ARAA_DATASET_VERSION);
  assert.ok(result.dataset.matched.some((item) => item.id === 'URL-G1006'));
});

test('A Core Raa explains blockers from evidence', () => {
  const result = analyzeAraaEvidence({ manifest: {}, missingAssets: ['a.js'], errors: ['G1006'], protectedResources: ['license'], totalFiles: 320 });
  assert.equal(result.findings.some((f) => f.id === 'ARAA-ASSET'), true);
  assert.equal(result.findings.some((f) => f.id === 'ARAA-PROTECTED'), true);
  assert.ok(result.priorities.length > 0);
});
