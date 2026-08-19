import assert from 'node:assert/strict';
import JSZip from 'jszip';

async function makeArchive(size) {
  const zip = new JSZip();
  zip.file('assets/large.txt', 'Z'.repeat(size));
  zip.file('web/index.html', '<!doctype html><html><body><h1>ZipScope</h1></body></html>');
  zip.file('media/cover.jpg', Buffer.from([255, 216, 255, 217]));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 1 } });
}

async function checkArchive(label, buffer, expectedSize) {
  const archive = await JSZip.loadAsync(buffer, { checkCRC32: false, createFolders: true });
  assert(archive.files['web/index.html'], label + ': HTML entry missing');
  assert(archive.files['media/cover.jpg'], label + ': image entry missing');
  const text = await archive.files['assets/large.txt'].async('string');
  assert.equal(text.length, expectedSize, label + ': large entry length mismatch');
  return Object.keys(archive.files).length;
}

const twelveMb = 12 * 1024 * 1024;
const fortyMb = 40 * 1024 * 1024;
const twelveCount = await checkArchive('12MB', await makeArchive(twelveMb), twelveMb);
const fortyCount = await checkArchive('40MB', await makeArchive(fortyMb), fortyMb);
let corruptRejected = false;
try { await JSZip.loadAsync(Buffer.from('not-a-zip')); } catch { corruptRejected = true; }
assert(corruptRejected, 'corrupt archive should reject');
console.log(JSON.stringify({ ok: true, twelveCount, fortyCount, corruptRejected }));
