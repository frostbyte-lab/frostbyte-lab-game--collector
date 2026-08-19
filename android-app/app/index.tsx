import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import JSZip from 'jszip';
import { useColors } from '@/hooks/useColors';

type ZipEntry = {
  name: string;
  size: number;
  isDirectory: boolean;
  extension: string;
  kind: 'web' | 'image' | 'audio' | 'video' | 'code' | 'other';
  zipObject?: JSZip.JSZipObject;
};

const imageTypes = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
const audioTypes = ['mp3', 'wav', 'ogg', 'm4a', 'aac'];
const videoTypes = ['mp4', 'mov', 'webm', 'mkv', 'avi'];
const codeTypes = ['html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'py3', 'json', 'md', 'txt', 'xml', 'yml', 'yaml'];

function kindFor(extension: string): ZipEntry['kind'] {
  if (extension === 'html' || extension === 'htm') return 'web';
  if (imageTypes.includes(extension)) return 'image';
  if (audioTypes.includes(extension)) return 'audio';
  if (videoTypes.includes(extension)) return 'video';
  if (codeTypes.includes(extension)) return 'code';
  return 'other';
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(kind: ZipEntry['kind']): keyof typeof Ionicons.glyphMap {
  return { web: 'globe-outline', image: 'image-outline', audio: 'musical-notes-outline', video: 'videocam-outline', code: 'code-slash-outline', other: 'document-outline' }[kind] as keyof typeof Ionicons.glyphMap;
}

export default function ZipPreviewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [archiveName, setArchiveName] = useState('');
  const [entries, setEntries] = useState<ZipEntry[]>([]);
  const [selected, setSelected] = useState<ZipEntry | null>(null);
  const [previewText, setPreviewText] = useState('');
  const [previewUri, setPreviewUri] = useState('');
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [fullPreview, setFullPreview] = useState(false);

  const log = (message: string) => {
    setLogs((current) => [`${new Date().toLocaleTimeString()}  ${message}`, ...current].slice(0, 60));
  };

  const openArchive = async () => {
    await Haptics.selectionAsync();
    setBusy(true);
    setLogs([]);
    setEntries([]);
    setSelected(null);
    setPreviewText('');
    setPreviewUri('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'application/x-zip-compressed', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setArchiveName(asset.name);
      log(`Membuka ${asset.name} (${formatBytes(asset.size ?? 0)})`);
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      log(`Membaca buffer ZIP (${formatBytes(base64.length * 0.75)})`);
      const zip = await JSZip.loadAsync(base64, { base64: true, checkCRC32: false });
      const nextEntries: ZipEntry[] = [];
      zip.forEach((name, object) => {
        const extension = name.split('.').pop()?.toLowerCase() ?? '';
        const metadata = object as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } };
        nextEntries.push({
          name,
          size: metadata._data?.uncompressedSize ?? 0,
          isDirectory: object.dir,
          extension,
          kind: kindFor(extension),
          zipObject: object,
        });
      });
      nextEntries.sort((a, b) => Number(a.isDirectory) - Number(b.isDirectory) || a.name.localeCompare(b.name));
      setEntries(nextEntries);
      log(`Berhasil membaca ${nextEntries.length} item`);
      if (nextEntries.length) await selectEntry(nextEntries.find((item) => !item.isDirectory) ?? nextEntries[0]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Format ZIP tidak dapat dibaca';
      log(`ERROR: ${message}`);
      Alert.alert('ZIP tidak terbuka', 'File mungkin rusak atau terenkripsi. Coba salin ulang file lalu buka kembali.');
    } finally {
      setBusy(false);
    }
  };

  const selectEntry = async (entry: ZipEntry) => {
    if (entry.isDirectory || !entry.zipObject) return;
    await Haptics.selectionAsync();
    setSelected(entry);
    setPreviewText('');
    setPreviewUri('');
    try {
      if (entry.kind === 'code' || entry.kind === 'web') {
        const text = await entry.zipObject.async('string');
        setPreviewText(text.slice(0, 20000));
        log(`Preview teks: ${entry.name}`);
        return;
      }
      const base64 = await entry.zipObject.async('base64');
      const safeName = entry.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const uri = `${FileSystem.cacheDirectory}zip-preview-${Date.now()}-${safeName}`;
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
      setPreviewUri(uri);
      log(`Preview aset: ${entry.name}`);
    } catch (error) {
      log(`ERROR preview ${entry.name}: ${error instanceof Error ? error.message : 'gagal membaca file'}`);
    }
  };

  const shareSelected = async () => {
    if (!previewUri || !(await Sharing.isAvailableAsync())) {
      Alert.alert('Belum tersedia', 'Preview file ini belum bisa dibagikan dari perangkat.');
      return;
    }
    await Sharing.shareAsync(previewUri);
  };

  const stats = useMemo(() => ({
    files: entries.filter((entry) => !entry.isDirectory).length,
    media: entries.filter((entry) => ['image', 'audio', 'video'].includes(entry.kind)).length,
  }), [entries]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>FROSTBYTE FILE LAB</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>ZipScope</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Buka ZIP besar. Lihat isinya. Temukan error.</Text>
        </View>
        <View style={[styles.statusDot, { backgroundColor: colors.primary }]} />
      </View>

      <Pressable testID="choose-zip" onPress={openArchive} style={({ pressed }) => [styles.openButton, { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 }]}>
        {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Ionicons name="folder-open-outline" size={21} color={colors.primaryForeground} />}
        <Text style={[styles.openButtonText, { color: colors.primaryForeground }]}>{busy ? 'Membaca ZIP...' : 'Pilih file ZIP'}</Text>
      </Pressable>

      <View style={styles.archiveRow}>
        <View style={[styles.archiveIcon, { backgroundColor: colors.secondary }]}>
          <Ionicons name="archive-outline" size={20} color={colors.primary} />
        </View>
        <View style={styles.archiveMeta}>
          <Text numberOfLines={1} style={[styles.archiveName, { color: colors.foreground }]}>{archiveName || 'Belum ada arsip dipilih'}</Text>
          <Text style={[styles.archiveStats, { color: colors.mutedForeground }]}>{entries.length ? `${stats.files} file  ·  ${stats.media} aset media` : 'Mendukung ZIP besar dan folder bersarang'}</Text>
        </View>
        {entries.length > 0 && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
      </View>

      <View style={styles.workspace}>
        {!fullPreview && (
          <View style={[styles.filePanel, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={styles.panelHeading}>
              <Text style={[styles.panelTitle, { color: colors.foreground }]}>Isi ZIP</Text>
              <Text style={[styles.count, { color: colors.mutedForeground }]}>{entries.length}</Text>
            </View>
            <FlatList
              data={entries}
              keyExtractor={(item) => item.name}
              contentContainerStyle={styles.fileList}
              ListEmptyComponent={<View style={styles.empty}><Ionicons name="layers-outline" size={28} color={colors.mutedForeground} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>Arsip belum dibuka</Text><Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Pilih ZIP untuk menampilkan semua asetnya.</Text></View>}
              renderItem={({ item }) => (
                <Pressable onPress={() => selectEntry(item)} style={[styles.fileItem, selected?.name === item.name && { backgroundColor: colors.accent }]}>
                  <Ionicons name={item.isDirectory ? 'folder-outline' : iconFor(item.kind)} size={19} color={item.isDirectory ? colors.primary : colors.mutedForeground} />
                  <View style={styles.fileText}><Text numberOfLines={1} style={[styles.fileName, { color: colors.foreground }]}>{item.name}</Text><Text style={[styles.fileSize, { color: colors.mutedForeground }]}>{item.isDirectory ? 'folder' : formatBytes(item.size)} · {item.kind}</Text></View>
                </Pressable>
              )}
            />
          </View>
        )}

        {!fullPreview && (
          <View style={styles.splitter}><View style={[styles.splitterLine, { backgroundColor: colors.border }]} /></View>
        )}

        <View style={[styles.previewPanel, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={styles.panelHeading}>
            <View style={styles.panelHeadingLabel}><View style={[styles.liveDot, { backgroundColor: colors.primary }]} /><Text style={[styles.panelTitle, { color: colors.foreground }]}>Preview</Text></View>
            <View style={styles.panelActions}>
              {previewUri && <Pressable onPress={shareSelected} hitSlop={10}><Ionicons name="share-outline" size={19} color={colors.mutedForeground} /></Pressable>}
              <Pressable onPress={() => setFullPreview((value) => !value)} hitSlop={10}><Ionicons name={fullPreview ? 'contract-outline' : 'expand-outline'} size={19} color={colors.mutedForeground} /></Pressable>
            </View>
          </View>
          <View style={styles.previewBody}>
            {!selected && <View style={styles.empty}><Ionicons name="scan-outline" size={30} color={colors.mutedForeground} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>Pilih file untuk preview</Text><Text style={[styles.emptyText, { color: colors.mutedForeground }]}>HTML, gambar, audio, video, CSS, JavaScript, Python, dan file teks didukung.</Text></View>}
            {selected?.kind === 'image' && previewUri && <Image source={{ uri: previewUri }} resizeMode="contain" style={styles.imagePreview} />}
            {selected && ['audio', 'video'].includes(selected.kind) && <View style={styles.mediaPlaceholder}><Ionicons name={selected.kind === 'audio' ? 'musical-notes-outline' : 'videocam-outline'} size={42} color={colors.primary} /><Text style={[styles.mediaTitle, { color: colors.foreground }]}>{selected.name.split('/').pop()}</Text><Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{formatBytes(selected.size)} · {selected.kind.toUpperCase()}</Text>{previewUri && <Pressable onPress={() => Linking.openURL(previewUri)} style={[styles.outlineButton, { borderColor: colors.border }]}><Text style={[styles.outlineText, { color: colors.primary }]}>Buka dengan aplikasi perangkat</Text></Pressable>}</View>}
            {selected && (selected.kind === 'code' || selected.kind === 'web') && <ScrollView style={styles.codeScroll} contentContainerStyle={styles.codeContent}><Text selectable style={[styles.code, { color: colors.foreground }]}>{previewText || 'Memuat preview...'}</Text></ScrollView>}
            {selected?.kind === 'other' && <View style={styles.empty}><Ionicons name="document-text-outline" size={32} color={colors.primary} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>File siap diekspor</Text><Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Format {selected.extension || 'tanpa ekstensi'} belum punya renderer internal.</Text>{previewUri && <Pressable onPress={shareSelected} style={[styles.outlineButton, { borderColor: colors.border }]}><Text style={[styles.outlineText, { color: colors.primary }]}>Bagikan file</Text></Pressable>}</View>}
          </View>
        </View>

        {!fullPreview && <View style={[styles.logPanel, { backgroundColor: colors.secondary, borderColor: colors.border }]}><View style={styles.panelHeading}><View style={styles.panelHeadingLabel}><Ionicons name="terminal-outline" size={17} color={colors.mutedForeground} /><Text style={[styles.panelTitle, { color: colors.foreground }]}>Log error</Text></View><Text style={[styles.count, { color: colors.mutedForeground }]}>{logs.length}</Text></View><ScrollView style={styles.logScroll}><Text selectable style={[styles.logText, { color: colors.mutedForeground }]}>{logs.length ? logs.join('\n') : 'Tidak ada error. Log proses akan muncul di sini.'}</Text></ScrollView></View>}
      </View>
      <Text style={[styles.footer, { color: colors.mutedForeground }]}>Preview 70%  ·  Error log 30%  ·  Fullscreen tersedia</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 14 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.7 },
  title: { fontSize: 31, fontWeight: '700', letterSpacing: -1.1, marginTop: 2 },
  subtitle: { fontSize: 13, marginTop: 3 },
  statusDot: { width: 9, height: 9, borderRadius: 9, marginTop: 9 },
  openButton: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 },
  openButtonText: { fontSize: 14, fontWeight: '700' },
  archiveRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  archiveIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  archiveMeta: { flex: 1, marginHorizontal: 11 },
  archiveName: { fontSize: 14, fontWeight: '600' },
  archiveStats: { fontSize: 11, marginTop: 3 },
  workspace: { flex: 1, minHeight: 260 },
  filePanel: { flex: 1, minHeight: 130, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  previewPanel: { flex: 2.25, minHeight: 195, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  logPanel: { flex: 1, minHeight: 90, marginTop: 10, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  splitter: { height: 8, alignItems: 'center', justifyContent: 'center' },
  splitterLine: { width: 35, height: 3, borderRadius: 3 },
  panelHeading: { minHeight: 43, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelHeadingLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  panelTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  panelActions: { flexDirection: 'row', gap: 16 },
  liveDot: { width: 7, height: 7, borderRadius: 7 },
  count: { fontSize: 11 },
  fileList: { paddingHorizontal: 7, paddingBottom: 8 },
  fileItem: { minHeight: 48, borderRadius: 10, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 9 },
  fileText: { flex: 1 },
  fileName: { fontSize: 12, fontWeight: '600' },
  fileSize: { fontSize: 10, marginTop: 3 },
  previewBody: { flex: 1, padding: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 25, gap: 7 },
  emptyTitle: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  emptyText: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  imagePreview: { flex: 1, width: '100%', height: '100%' },
  mediaPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  mediaTitle: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  outlineButton: { marginTop: 10, paddingVertical: 9, paddingHorizontal: 13, borderWidth: 1, borderRadius: 10 },
  outlineText: { fontSize: 11, fontWeight: '700' },
  codeScroll: { flex: 1, borderRadius: 10, backgroundColor: '#06101d' },
  codeContent: { padding: 12 },
  code: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 17 },
  logScroll: { flex: 1, paddingHorizontal: 12, paddingBottom: 10 },
  logText: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 16 },
  footer: { fontSize: 10, textAlign: 'center', paddingTop: 8, paddingBottom: 12 },
});