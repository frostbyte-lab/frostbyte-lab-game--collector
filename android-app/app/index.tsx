import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';

const LIVE_URL = 'https://game-resource-collector.technologiesfrostbyte.workers.dev/';

export default function LiveCollectorApp() {
  const webViewRef = useRef<WebView>(null);
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

  return (
    <View style={styles.root}>
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
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08111f' },
  webView: { flex: 1, backgroundColor: '#08111f' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#08111f', gap: 12 },
  brand: { color: '#5ee1c0', fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  title: { color: '#f4f7fb', fontSize: 22, fontWeight: '700', marginBottom: 12 },
  progress: { position: 'absolute', top: 8, right: 12 },
  errorOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#08111f' },
  errorTitle: { color: '#f4f7fb', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  errorText: { color: '#aebed0', fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 18 },
  retryButton: { backgroundColor: '#5ee1c0', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 10 },
  retryText: { color: '#07131d', fontWeight: '800' },
});
