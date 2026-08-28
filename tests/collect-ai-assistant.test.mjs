import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
assert.match(html, /id="collect-ai-readiness"/);
assert.match(html, /id="collect-ai-status"/);
assert.match(html, /id="offline-ready-ai"/);
assert.match(html, /function gcRunOfflineReadinessAssistant\(/);
assert.match(html, /callCustomAIWithFailover\(\[/);
assert.match(html, /Cloudflare Capture/);
assert.match(html, /GitHub Actions Collect/);
assert.match(html, /browser network-off/i);
console.log('collect AI readiness assistant test passed');
