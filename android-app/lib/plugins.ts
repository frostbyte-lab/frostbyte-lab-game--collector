export type PluginCategory = 'Editor' | 'Kualitas' | 'Pratinjau' | 'AI' | 'Integrasi';

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
  { id: 'syntax-highlight', name: 'Sorotan Sintaks', description: 'Pewarnaan kata kunci, teks, komentar, angka, tag, properti, dan operator.', category: 'Editor', enabledByDefault: true, availableOffline: true },
  { id: 'code-editor', name: 'Editor Kode', description: 'Mode ubah, nomor baris, papan ketik monospace, dan penyimpanan perubahan lokal.', category: 'Editor', enabledByDefault: true, availableOffline: true },
  { id: 'code-audit', name: 'Audit Kode', description: 'Deteksi URL eksternal, TODO/FIXME, pencatatan, dan pembatas yang tidak seimbang.', category: 'Kualitas', enabledByDefault: true, availableOffline: true },
  { id: 'html-preview', name: 'Pratinjau HTML', description: 'Jalankan HTML dalam WebView terisolasi untuk pratinjau cepat.', category: 'Pratinjau', enabledByDefault: true, availableOffline: true },
  { id: 'media-preview', name: 'Pratinjau Media', description: 'Pratinjau gambar, audio, dan video dengan penampil bawaan.', category: 'Pratinjau', enabledByDefault: true, availableOffline: true },
  { id: 'json-tools', name: 'Alat JSON', description: 'Validasi struktur JSON melalui audit lokal dan pembacaan berwarna.', category: 'Kualitas', enabledByDefault: true, availableOffline: true },
  { id: 'asset-inspector', name: 'Pemeriksa Aset', description: 'Baca metadata aset dan ukuran file dari ZIP tanpa mengekstraknya seluruhnya.', category: 'Kualitas', enabledByDefault: true, availableOffline: true },
  { id: 'ai-assistant', name: 'Asisten AI', description: 'Analisis dan saran perbaikan kode melalui Worker resmi saat perangkat daring; gunakan audit lokal saat luring.', category: 'AI', enabledByDefault: true, availableOffline: false, requiresNetwork: true },
  { id: 'github-sync', name: 'Sinkronisasi GitHub', description: 'Sinkronisasi repositori memerlukan login dan koneksi resmi.', category: 'Integrasi', enabledByDefault: false, availableOffline: false, requiresNetwork: true },
];

export const DEFAULT_PLUGIN_STATE = Object.fromEntries(PLUGINS.map(plugin => [plugin.id, plugin.enabledByDefault])) as Record<string, boolean>;
