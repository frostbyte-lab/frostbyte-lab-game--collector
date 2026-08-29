import assert from 'node:assert/strict';
import { buildConformanceReport, redactValue, normalizeEndpoint, classifyEndpoint } from '../src/offline/conformance-lab.js';

assert.equal(redactValue({ authorization: 'Bearer secret', nested: { token: 'abc' }, value: 1 }).authorization, '<redacted>');
assert.deepEqual(normalizeEndpoint({ method: 'post', url: 'https://provider.test/api/round/1234567890123456/spin' }), { method: 'POST', path: '/api/round/:id/spin', status: 0 });
assert.equal(classifyEndpoint({ method: 'POST', path: '/api/spin' }), 'spin');

const report = buildConformanceReport({
  exchanges: [
    { method: 'POST', path: '/session', request: {}, response: {} },
    { method: 'GET', path: '/balance', request: {}, response: {} },
    { method: 'POST', path: '/spin', request: { bet: 1 }, response: {} },
    { method: 'GET', path: '/result', request: {}, response: {} }
  ],
  realtime: [{ transport: 'websocket', type: 'round.result', sequence: 1, payload: { token: 'secret', win: 2 } }]
});
assert.equal(report.status, 'CONTRACT_COVERAGE_READY');
assert.equal(report.score, 100);
assert.deepEqual(report.missingKinds, []);
assert.equal(report.realtimeCoverage[0].payload.token, '<redacted>');
console.log('conformance lab test passed');
