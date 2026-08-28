import assert from 'node:assert/strict';
import { runManusTask } from '../src/lib/manus-api.js';

const missing = await runManusTask({}, { prompt: 'test' });
assert.equal(missing.status, 503);
assert.equal((await missing.json()).error, 'MANUS_NOT_CONFIGURED');

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url, init });
  if (url.endsWith('/task.create')) {
    return new Response(JSON.stringify({ task_id: 'task_test_123', task_url: 'https://manus.ai/task_test_123' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('/task.listMessages?')) {
    return new Response(JSON.stringify({ messages: [
      { status_update: { agent_status: 'stopped' } },
      { assistant_message: { content: 'Jawaban smoke test Manus.' } }
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`Unexpected URL ${url}`);
};

const result = await runManusTask({ MANUS_API_KEY: '' }, {
  prompt: 'Berikan jawaban singkat.',
  title: 'Smoke test',
  agent_profile: 'manus-1.6-lite',
  timeout_ms: 5000,
  api_key: 'personal-secret-test-only'
});
assert.equal(result.status, 200);
const body = await result.json();
assert.equal(body.ok, true);
assert.equal(body.provider, 'manus');
assert.equal(body.content, 'Jawaban smoke test Manus.');
assert.equal(calls.length, 2);
const createInit = JSON.parse(calls[0].init.body);
assert.equal(createInit.message.content, 'Berikan jawaban singkat.');
assert.equal(createInit.agent_profile, 'manus-1.6-lite');
assert.equal(calls[0].init.headers['x-manus-api-key'], 'personal-secret-test-only');
assert.match(calls[1].url, /task_id=task_test_123/);
console.log('Manus API helper smoke test passed');
