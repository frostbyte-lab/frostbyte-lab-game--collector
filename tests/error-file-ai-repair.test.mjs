import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('every editor file row exposes an A Core Raa repair action', () => {
  assert.match(html, /file-tree-ai-repair/);
  assert.match(html, /Perbaiki file dengan A Core Raa offline/);
  assert.match(html, /openErrFixPopup\(entry\.__path\)/);
});

test('scan errors expose an explicit [!] marker and preserve file navigation', () => {
  assert.match(html, /file-tree-error-mark/);
  assert.match(html, /\[!\]/);
  assert.match(html, /fileEl\.dataset\.path = entry\.__path/);
});

test('error AI assistance is offline-bound and does not name external providers', () => {
  assert.match(html, /A Core Raa offline: siap menganalisis/);
  assert.match(html, /Jangan gunakan API AI eksternal/);
  assert.doesNotMatch(html, /OpenRouter: siap tanya/);
});
