import { readFileSync, writeFileSync } from 'node:fs';

const path = 'android-app/components/ZipPreviewScreen.tsx';
const source = readFileSync(path, 'utf8');
const pattern = /  const askAI = async \(\) => \{[\s\S]*?\n  const applyAIResult/;
const replacement = `  const askAI = async () => {\n    if (!selected || !previewText) return;\n    if (!pluginState['ai-assistant']) { log('PLUGIN: AI Assistant sedang nonaktif.'); return; }\n    setAiPanel(true);\n    setAiBusy(true);\n    const findings = analyzeCode(previewText, selected);\n    setAiResult('Analisis lokal/offline\\n\\n' + findings.map(item => '• ' + item).join('\\n') + '\\n\\nAI online dinonaktifkan pada build mandiri tanpa Cloudflare.');\n    log('AI Assistant offline selesai menganalisis: ' + selected.name);\n    setAiBusy(false);\n  };\n  const applyAIResult`;
if (!pattern.test(source)) throw new Error('askAI block not found');
writeFileSync(path, source.replace(pattern, replacement));
