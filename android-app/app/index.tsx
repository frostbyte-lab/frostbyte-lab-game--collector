import ZipPreviewScreen from '@/components/ZipPreviewScreen';

/**
 * Collector native/offline entry point.
 * Tidak memuat Worker, Cloudflare, atau URL eksternal saat startup.
 */
export default function CollectorApp() {
  return <ZipPreviewScreen />;
}
