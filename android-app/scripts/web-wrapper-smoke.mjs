import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../app/index.tsx', import.meta.url), 'utf8');
assert.match(source, /game-resource-collector\.technologiesfrostbyte\.workers\.dev/);
assert.match(source, /<WebView/);
assert.match(source, /javaScriptEnabled/);
assert.match(source, /domStorageEnabled/);
assert.match(source, /Coba lagi/);
assert.doesNotMatch(source, /ZipPreviewScreen|DocumentPicker|expo-av|JSZip|KeyboardProvider/);
console.log('web wrapper smoke test passed');
