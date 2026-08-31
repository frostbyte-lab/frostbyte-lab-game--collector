import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('preview and live log use a responsive side-by-side workspace', () => {
  assert.match(html, /preview-workspace\.pv-main-split\{display:grid/);
  assert.match(html, /grid-template-columns:minmax\(0,1\.55fr\) minmax\(280px,\.75fr\)/);
  assert.match(html, /overflow:hidden!important/);
});

test('preview controls explain capture and offline audit behavior', () => {
  assert.match(html, /Preview · Mulai Capture/);
  assert.match(html, /Capture · Audit Offline/);
  assert.match(html, /A Core Raa · Audit Offline/);
  assert.match(html, /mode capture berjalan/);
  assert.match(html, /kesiapan offline/);
});
