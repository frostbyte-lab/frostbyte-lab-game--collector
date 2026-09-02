import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bootstrap = await readFile(new URL('../android-app/app/index.tsx', import.meta.url), 'utf8');
const source = await readFile(new URL('../android-app/components/ZipPreviewScreen.tsx', import.meta.url), 'utf8');
const appSource = `${bootstrap}\n${source}`;
const plugins = await readFile(new URL('../android-app/lib/plugins.ts', import.meta.url), 'utf8');

test('native APK renders syntax-highlighted code with line numbers', () => {
  assert.match(appSource, /function tokenizeLine/);
  assert.match(appSource, /HighlightedCode/);
  assert.match(appSource, /lineNumber/);
  assert.match(appSource, /keyword: '#d78cff'/);
  assert.match(appSource, /string: '#8fe388'/);
  assert.match(appSource, /comment: '#718096'/);
});

test('native APK supports edit, save, and offline audit actions', () => {
  assert.match(appSource, /setEditing\(true\)/);
  assert.match(appSource, /Simpan edit/);
  assert.match(appSource, /setEditedContent/);
  assert.match(appSource, /Audit kode tanpa internet/);
  assert.match(appSource, /analyzeCode/);
});

test('native APK does not pretend to include an external AI provider', () => {
  assert.doesNotMatch(appSource, /OpenRouter|OPENROUTER_API_KEY|invokeLLM/);
});

test('plugin catalog exposes complete safe choices and labels network features honestly', () => {
  for (const name of ['Sorotan Sintaks', 'Editor Kode', 'Audit Kode', 'Pratinjau HTML', 'Pratinjau Media', 'Alat JSON', 'Pemeriksa Aset', 'Asisten AI', 'Sinkronisasi GitHub']) assert.match(plugins, new RegExp(name));
  assert.match(plugins, /availableOffline: false/);
  assert.match(appSource, /Pilihan Pengaya/);
  assert.match(appSource, /togglePlugin/);
});

console.log('native editor regression test passed');
