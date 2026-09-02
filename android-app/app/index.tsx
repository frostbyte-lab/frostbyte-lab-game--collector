import React, { Suspense, lazy, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

const ZipPreviewScreen = lazy(() => import('../components/ZipPreviewScreen'));

export default function BootstrapScreen() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!ready) {
    return (
      <View style={styles.bootstrap}>
        <Text style={styles.brand}>FROSTBYTE</Text>
        <Text style={styles.product}>ZipScope</Text>
        <ActivityIndicator color="#5ee1c0" style={styles.spinner} />
      </View>
    );
  }

  return (
    <Suspense fallback={<View style={styles.bootstrap}><Text style={styles.brand}>FROSTBYTE</Text><Text style={styles.product}>ZipScope</Text><ActivityIndicator color="#5ee1c0" style={styles.spinner} /></View>}>
      <ZipPreviewScreen />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  bootstrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#08111f' },
  brand: { color: '#5ee1c0', fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  product: { color: '#f4f7fb', fontSize: 30, fontWeight: '700', marginTop: 8 },
  spinner: { marginTop: 24 },
});
