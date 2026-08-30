import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAraaEvidence, ARAA_IDENTITY, redactAraaEvidence } from '../src/araa-core.js';

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

test('A Core Raa explains blockers from evidence', () => {
  const result = analyzeAraaEvidence({ manifest: {}, missingAssets: ['a.js'], errors: ['G1006'], protectedResources: ['license'], totalFiles: 320 });
  assert.equal(result.findings.some((f) => f.id === 'ARAA-ASSET'), true);
  assert.equal(result.findings.some((f) => f.id === 'ARAA-PROTECTED'), true);
  assert.ok(result.priorities.length > 0);
});
