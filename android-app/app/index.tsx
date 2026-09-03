import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import ZipPreviewScreen from '@/components/ZipPreviewScreen';

const LIVE_URL = 'https://game-resource-collector.technologiesfrostbyte.workers.dev/';

type AppMode = 'web' | 'native-editor';

export default function LiveCollectorApp() {
  const webViewRef = useRef<WebView>(null);
  const [mode, setMode] = useState<AppMode>('web');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const retry = () => {
    setFailed(false);
    setLoading(true);
    webViewRef.current?.reload();
  };

  const handleNavigation = (request: WebViewNavigation) => {
    if (request.url.startsWith('https://') || request.url.startsWith('http://')) return true;
    return false;
  };

  if (mode === 'native-editor') {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <StatusBar style="light" backgroundColor="#08111f" />
        <View style={styles.nativeTopBar}>
          <View>
            <Text style={styles.nativeEyebrow}>GAME COLLECTOR PRO</Text>
            <Text style={styles.nativeTitle}>Editor & Plugin</Text>
          </View>
          <Pressable onPress={() => setMode('web')} style={styles.backButton} accessibilityLabel="Kembali ke Collect web">
            <Text style={styles.backText}>Collect Web</Text>
          </Pressable>
        </View>
        <ZipPreviewScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="light" backgroundColor="#08111f" />
      <View style={styles.appBar}>
        <View style={styles.brandBlock}>
          <Text style={styles.brand}>FROSTBYTE</Text>
          <Text style={styles.appName}>Game Collector Pro</Text>
        </View>
        <Pressable onPress={() => setMode('native-editor')} style={styles.pluginButton} accessibilityLabel="Buka editor dan plugin">
          <Text style={styles.pluginButtonText}>Editor & Plugin</Text>
        </Pressable>
      </View>
      <View style={styles.webFrame}>
        <WebView
          ref={webViewRef}
          source={{ uri: LIVE_URL }}
          style={styles.webView}
          originWhitelist={['https://*', 'http://*']}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowFileAccess
          allowingReadAccessToURL={LIVE_URL}
          setSupportMultipleWindows={false}
          startInLoadingState
          onLoadStart={() => {
            setLoading(true);
            setFailed(false);
          }}
          onLoadEnd={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setFailed(true);
          }}
          onShouldStartLoadWithRequest={handleNavigation}
          renderLoading={() => (
            <View style={styles.loading}>
              <Text style={styles.brand}>FROSTBYTE</Text>
              <Text style={styles.title}>Game Collector Pro</Text>
              <ActivityIndicator color="#5ee1c0" size="large" />
            </View>
          )}
        />
        {loading && (
          <View pointerEvents="none" style={styles.progress}>
            <ActivityIndicator color="#5ee1c0" size="small" />
          </View>
        )}
        {failed && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorTitle}>Web live belum dapat dibuka</Text>
            <Text style={styles.errorText}>Periksa koneksi internet, lalu coba lagi.</Text>
            <Pressable onPress={retry} style={styles.retryButton}>
              <Text style={styles.retryText}>Coba lagi</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08111f' },
  webFrame: { flex: 1, position: 'relative' },
  webView: { flex: 1, backgroundColor: '#08111f' },
  appBar: { minHeight: 56, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: '#0e1826', borderBottomWidth: 1, borderBottomColor: '#203148' },
  brandBlock: { flex: 1 },
  brand: { color: '#5ee1c0', fontSize: 11, fontWeight: '800', letterSpacing: 1.8 },
  appName: { color: '#f4f7fb', fontSize: 14, fontWeight: '700', marginTop: 1 },
  pluginButton: { minHeight: 38, paddingHorizontal: 12, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2e5c52', borderWidth: 1, borderColor: '#5ee1c0' },
  pluginButtonText: { color: '#f4f7fb', fontSize: 11, fontWeight: '800' },
  nativeTopBar: { minHeight: 64, paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: '#0e1826', borderBottomWidth: 1, borderBottomColor: '#203148' },
  nativeEyebrow: { color: '#5ee1c0', fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  nativeTitle: { color: '#f4f7fb', fontSize: 17, fontWeight: '700', marginTop: 2 },
  backButton: { minHeight: 38, paddingHorizontal: 11, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#151f2d', borderWidth: 1, borderColor: '#3a506a' },
  backText: { color: '#dbe7f4', fontSize: 11, fontWeight: '800' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#08111f', gap: 12 },
  title: { color: '#f4f7fb', fontSize: 22, fontWeight: '700', marginBottom: 12 },
  progress: { position: 'absolute', top: 8, right: 12 },
  errorOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#08111f' },
  errorTitle: { color: '#f4f7fb', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  errorText: { color: '#aebed0', fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 18 },
  retryButton: { backgroundColor: '#5ee1c0', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 10 },
  retryText: { color: '#07131d', fontWeight: '800' },
});
