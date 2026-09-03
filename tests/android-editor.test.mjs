import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../android-app/app/index.tsx', import.meta.url), 'utf8');

test('Android APK opens the same Game Collector Pro web application', () => {
  assert.match(source, /game-resource-collector\.technologiesfrostbyte\.workers\.dev/);
  assert.match(source, /<WebView/);
  assert.match(source, /javaScriptEnabled/);
  assert.match(source, /domStorageEnabled/);
});

test('Android APK has a visible network failure fallback', () => {
  assert.match(source, /Web utama tidak dapat dibuka/);
  assert.match(source, /Coba lagi/);
  assert.match(source, /Buka di browser/);
});

test('Android APK does not load the old native ZIP application at startup', () => {
  assert.doesNotMatch(source, /ZipPreviewScreen|DocumentPicker|expo-av|JSZip|KeyboardProvider/);
});

console.log('Android web-wrapper regression test passed');
