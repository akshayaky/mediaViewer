import { useState } from 'react';
import { MediaType } from '../types/media';
import { localScannerService, ScanResult } from '../services/LocalScannerService';

export function useLibraryScanner() {
  const [scanningType, setScanningType] = useState<MediaType | null>(null);
  const [scanProgressCount, setScanProgressCount] = useState<number>(0);
  const [scanResult, setScanResult] = useState<{ type: MediaType; result: ScanResult } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const scanFolder = async (folderPath: string, mediaType: MediaType) => {
    if (!folderPath.trim()) {
      setScanError('Enter a folder path before scanning.');
      return;
    }

    setScanningType(mediaType);
    setScanProgressCount(0);
    setScanResult(null);
    setScanError(null);

    try {
      const result = await localScannerService.scanFolder(
        folderPath,
        mediaType,
        undefined,
        (count) => setScanProgressCount(count)
      );

      await new Promise(res => setTimeout(res, 300));

      setScanResult({ type: mediaType, result });
      window.dispatchEvent(new CustomEvent('library-scanned'));
    } catch (err: unknown) {
      console.error('Directory scan error:', err);
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanningType(null);
    }
  };

  return {
    scanningType,
    scanProgressCount,
    scanResult,
    scanError,
    scanFolder
  };
}
