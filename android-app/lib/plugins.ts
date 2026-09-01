export type PluginCategory = 'Editor' | 'Quality' | 'Preview' | 'AI' | 'Integrasi';

export type EditorPlugin = {
  id: string;
  name: string;
  description: string;
  category: PluginCategory;
  enabledByDefault: boolean;
  availableOffline: boolean;
  requiresNetwork?: boolean;
};

export const PLUGINS: EditorPlugin[] = [
  { id: 'syntax-highlight', name: 'Syntax Highlight', description: 'Warna keyword, string, komentar, angka, tag, property, dan operator.', category: 'Editor', enabledByDefault: true, availableOffline: true },
  { id: 'code-editor', name: 'Code Editor', description: 'Mode edit, nomor baris, keyboard monospace, dan simpan perubahan lokal.', category: 'Editor', enabledByDefault: true, availableOffline: true },
  { id: 'code-audit', name: 'Code Audit', description: 'Deteksi URL eksternal, TODO/FIXME, logging, dan delimiter tidak seimbang.', category: 'Quality', enabledByDefault: true, availableOffline: true },
  { id: 'html-preview', name: 'HTML Preview', description: 'Jalankan HTML dalam WebView sandbox untuk preview cepat.', category: 'Preview', enabledByDefault: true, availableOffline: true },
  { id: 'media-preview', name: 'Media Preview', description: 'Preview gambar, audio, dan video dengan renderer native.', category: 'Preview', enabledByDefault: true, availableOffline: true },
  { id: 'json-tools', name: 'JSON Tools', description: 'Validasi struktur JSON melalui audit lokal dan pembacaan berwarna.', category: 'Quality', enabledByDefault: true, availableOffline: true },
  { id: 'asset-inspector', name: 'Asset Inspector', description: 'Baca metadata aset dan ukuran file dari ZIP tanpa ekstraksi penuh.', category: 'Quality', enabledByDefault: true, availableOffline: true },
  { id: 'ai-assistant', name: 'AI Assistant', description: 'Analisis dan saran perbaikan kode melalui Worker resmi saat perangkat online; fallback audit lokal saat offline.', category: 'AI', enabledByDefault: true, availableOffline: false, requiresNetwork: true },
  { id: 'github-sync', name: 'GitHub Sync', description: 'Sinkronisasi repository memerlukan login dan koneksi resmi.', category: 'Integrasi', enabledByDefault: false, availableOffline: false, requiresNetwork: true },
];

export const DEFAULT_PLUGIN_STATE = Object.fromEntries(PLUGINS.map(plugin => [plugin.id, plugin.enabledByDefault])) as Record<string, boolean>;
