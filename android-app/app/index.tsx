import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

const MAIN_WEB_URL = 'https://game-resource-collector.technologiesfrostbyte.workers.dev/';

export default function CollectorApp() {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <View style={styles.error}>
        <Text style={styles.title}>Game Collector Pro</Text>
        <Text style={styles.message}>Web utama tidak dapat dibuka. Periksa koneksi internet lalu coba lagi.</Text>
        <Pressable style={styles.button} onPress={() => { setFailed(false); setLoading(true); }}>
          <Text style={styles.buttonText}>Coba lagi</Text>
        </Pressable>
        <Pressable onPress={() => Linking.openURL(MAIN_WEB_URL)}>
          <Text style={styles.link}>Buka di browser</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <WebView
        source={{ uri: MAIN_WEB_URL }}
        style={styles.webview}
        originWhitelist={['https://*']}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        onLoadStart={() => { setLoading(true); setFailed(false); }}
        onLoadEnd={() => setLoading(false)}
        onError={() => { setLoading(false); setFailed(true); }}
        onHttpError={(event) => { if (event.nativeEvent.statusCode >= 500) { setLoading(false); setFailed(true); } }}
      />
      {loading && <View style={styles.loading}><ActivityIndicator size="large" color="#5ee1c0" /><Text style={styles.loadingText}>Memuat Game Collector Pro…</Text></View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1116' },
  webview: { flex: 1, backgroundColor: '#0e1116' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0e1116' },
  loadingText: { color: '#e6e9ee', marginTop: 14, fontSize: 14 },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#0e1116' },
  title: { color: '#5ee1c0', fontSize: 24, fontWeight: '700' },
  message: { color: '#b0b8c4', textAlign: 'center', lineHeight: 22, marginTop: 12, marginBottom: 22 },
  button: { backgroundColor: '#2e5c52', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: '#ffffff', fontWeight: '700' },
  link: { color: '#5ee1c0', marginTop: 18, fontWeight: '600' },
});
