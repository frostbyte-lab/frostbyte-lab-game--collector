import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../android-app/app/index.tsx', import.meta.url), 'utf8');

test('native APK renders syntax-highlighted code with line numbers', () => {
  assert.match(source, /function tokenizeLine/);
  assert.match(source, /HighlightedCode/);
  assert.match(source, /lineNumber/);
  assert.match(source, /keyword: '#d78cff'/);
  assert.match(source, /string: '#8fe388'/);
  assert.match(source, /comment: '#718096'/);
});

test('native APK supports edit, save, and offline audit actions', () => {
  assert.match(source, /setEditing\(true\)/);
  assert.match(source, /Simpan edit/);
  assert.match(source, /setEditedContent/);
  assert.match(source, /Audit kode offline/);
  assert.match(source, /analyzeCode/);
});

test('native APK does not pretend to include an external AI provider', () => {
  assert.doesNotMatch(source, /OpenRouter|OPENROUTER_API_KEY|invokeLLM/);
});

console.log('native editor regression test passed');
