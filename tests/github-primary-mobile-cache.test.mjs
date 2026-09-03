import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('unified capture routes the primary flow through GitHub Actions', () => {
  assert.match(html, /Jalur utama: GitHub Actions/);
  assert.match(html, /return runGitHubCollect\(\)/);
  assert.match(html, /\/api\/github\/collect/);
});

test('mobile storage is opt-in and metadata-only', () => {
  assert.match(html, /gc-local-metadata-cache/);
  assert.match(html, /rawEvidenceStored: false/);
  assert.match(html, /Metadata capture disimpan lokal di HP/);
});

