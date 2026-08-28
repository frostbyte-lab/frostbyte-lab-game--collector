const fs = require('fs');
const path = require('path');
const htmlPath = path.resolve(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
if (!scripts.length) throw new Error('Tidak ada inline script');
for (let i = 0; i < scripts.length; i++) {
  new Function(scripts[i]);
  console.log(`inline script ${i + 1}: OK (${scripts[i].length} chars)`);
}
