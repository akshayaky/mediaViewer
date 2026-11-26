import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Camera, Check, Copy, Image as ImageIcon, QrCode, RefreshCw, Smartphone } from 'lucide-react';
import { syncEngine } from '../../sync/syncEngine';
import { PairingSession, SyncDeviceRecord } from '../../sync/types';

interface QrPairViewProps {
  activeSession: PairingSession | null;
  onPaired?: (device: SyncDeviceRecord) => void;
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

export const QrPairView: React.FC<QrPairViewProps> = ({ activeSession, onPaired }) => {
  const [mode, setMode] = useState<'host' | 'join'>('host');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [manualIpInput, setManualIpInput] = useState<string>('');
  const [qrTextInput, setQrTextInput] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [cameraActive, setCameraActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supportsBarcodeDetector =
    typeof window !== 'undefined' && typeof window.BarcodeDetector === 'function';

  // Render QR image whenever activeSession changes
  useEffect(() => {
    let cancelled = false;
    if (!activeSession?.qrText) {
      setQrDataUrl('');
      return;
    }

    QRCode.toDataURL(activeSession.qrText, {
      width: 224,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0c0e15', light: '#ffffff' },
    })
      .then(url => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(err => {
        if (!cancelled) {
          setLocalError(err instanceof Error ? err.message : 'Failed to render QR code.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSession?.qrText]);

  // Countdown timer for active QR session
  useEffect(() => {
    if (!activeSession) {
      setSecondsLeft(0);
      return;
    }

    const updateRemaining = () => {
      const remaining = Math.max(
        0,
        Math.ceil((Date.parse(activeSession.payload.expiresAt) - Date.now()) / 1000)
      );
      setSecondsLeft(remaining);
    };
    updateRemaining();
    const id = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(id);
  }, [activeSession]);

  // Clean up camera stream on unmount or mode switch
  const stopCamera = () => {
    if (scanTimerRef.current !== null) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => stopCamera, []);

  // Attach MediaStream once the <video> element mounts after cameraActive flips true
  useEffect(() => {
    if (!cameraActive || !videoRef.current || !streamRef.current) return;
    const videoEl = videoRef.current;
    videoEl.srcObject = streamRef.current;
    void videoEl.play().catch(() => {
      // Autoplay policies handled via muted + playsInline
    });
  }, [cameraActive]);

  const handleStartSession = async () => {
    setLocalError(null);
    setBusy(true);
    try {
      const overrideIps = manualIpInput
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      await syncEngine.startPairingSession(
        overrideIps.length > 0 ? { overrideIps } : undefined
      );
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to start pairing session.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyCode = async () => {
    if (!activeSession?.qrText) return;
    try {
      await navigator.clipboard.writeText(activeSession.qrText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setLocalError('Clipboard access unavailable; copy the pairing string manually.');
    }
  };

  const handlePairWithText = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setLocalError('Paste or scan a pairing QR code first.');
      return;
    }
    setLocalError(null);
    setBusy(true);
    try {
      const device = await syncEngine.pairWithQrText(trimmed);
      setQrTextInput('');
      stopCamera();
      onPaired?.(device);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Pairing failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleStartCameraScan = async () => {
    if (!supportsBarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setLocalError('Camera QR scanning is not supported in this runtime. Paste the pairing code below.');
      return;
    }
    setLocalError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);

      const detector = new window.BarcodeDetector!({ formats: ['qr_code'] });
      scanTimerRef.current = window.setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const raw = codes.find(c => c.rawValue)?.rawValue;
          if (raw) {
            setQrTextInput(raw);
            stopCamera();
            void handlePairWithText(raw);
          }
        } catch {
          // Ignore single-frame detection errors
        }
      }, 350);
    } catch (err) {
      stopCamera();
      setLocalError(err instanceof Error ? err.message : 'Could not access camera.');
    }
  };

  const handleScanImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!supportsBarcodeDetector) {
      setLocalError('QR image decoding is unavailable here; paste the pairing code text instead.');
      return;
    }
    setLocalError(null);
    try {
      const bitmap = await createImageBitmap(file);
      const detector = new window.BarcodeDetector!({ formats: ['qr_code'] });
      const codes = await detector.detect(bitmap);
      bitmap.close?.();
      const raw = codes.find(c => c.rawValue)?.rawValue;
      if (!raw) {
        setLocalError('No QR code detected in the selected image.');
        return;
      }
      setQrTextInput(raw);
      await handlePairWithText(raw);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to decode QR image.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl bg-[#0e1017] p-1 border border-[#232736]">
        <button
          type="button"
          onClick={() => {
            stopCamera();
            setMode('host');
            setLocalError(null);
          }}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
            mode === 'host'
              ? 'bg-[#1e2231] text-[#E27D12] border border-[#E27D12]/40'
              : 'text-gray-400 hover:text-gray-200 border border-transparent'
          }`}
        >
          <QrCode className="w-3.5 h-3.5" />
          <span>Show Host QR</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('join');
            setLocalError(null);
          }}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
            mode === 'join'
              ? 'bg-[#1e2231] text-[#E27D12] border border-[#E27D12]/40'
              : 'text-gray-400 hover:text-gray-200 border border-transparent'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>Pair with Device</span>
        </button>
      </div>

      {localError && (
        <div
          role="alert"
          className="text-xs text-rose-300 bg-rose-950/50 border border-rose-500/30 rounded-xl px-3.5 py-2.5"
        >
          {localError}
        </div>
      )}

      {mode === 'host' ? (
        <div className="bg-[#12141d] border border-[#232736] rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row gap-5 items-center">
            <div className="w-56 h-56 rounded-xl bg-white p-2 flex items-center justify-center shrink-0 border border-[#262b3d]">
              {qrDataUrl && secondsLeft > 0 ? (
                <img
                  src={qrDataUrl}
                  alt="Device pairing QR code"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-center px-4 space-y-2">
                  <QrCode className="w-10 h-10 text-gray-400 mx-auto" />
                  <p className="text-xs text-gray-600 font-medium">
                    {activeSession && secondsLeft === 0
                      ? 'Pairing QR expired'
                      : 'Generate a temporary QR code to pair another device on your Wi-Fi.'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex-1 w-full space-y-3 text-xs">
              <div className="space-y-1">
                <label className="block text-[11px] font-mono uppercase tracking-wider text-gray-400">
                  Optional LAN IP Override (comma-separated)
                </label>
                <input
                  type="text"
                  value={manualIpInput}
                  onChange={e => setManualIpInput(e.target.value)}
                  placeholder="Auto-detect Wi-Fi IPv4 (e.g. 192.168.1.25)"
                  className="w-full bg-[#0c0e15] border border-[#262b3d] rounded-lg px-3 py-2 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-[#E27D12]/60"
                />
              </div>

              {activeSession && (
                <div className="bg-[#0c0e15] border border-[#262b3d] rounded-xl p-3 space-y-1.5 text-[11px] text-gray-300">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Endpoints</span>
                    <span className="font-mono text-gray-200">
                      {activeSession.payload.ips.join(', ')}:{activeSession.payload.port}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Expires in</span>
                    <span
                      className={`font-mono font-semibold ${
                        secondsLeft > 15 ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {secondsLeft}s
                    </span>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleStartSession}
                  className="px-3.5 py-2 rounded-lg bg-[#E27D12] hover:bg-[#f08b22] disabled:opacity-50 text-black font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                  <span>{activeSession ? 'Refresh QR' : 'Generate Pairing QR'}</span>
                </button>

                {activeSession && (
                  <>
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="px-3 py-2 rounded-lg bg-[#1b1f2e] hover:bg-[#24293b] border border-[#2e344b] text-gray-200 font-medium text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copied ? 'Copied' : 'Copy Code'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => syncEngine.cancelPairingSession()}
                      className="px-3 py-2 rounded-lg bg-transparent hover:bg-[#1b1f2e] border border-[#262b3d] text-gray-400 text-xs cursor-pointer"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-[#12141d] border border-[#232736] rounded-2xl p-4 sm:p-5 space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleScanImageFile}
            className="hidden"
          />

          {cameraActive && (
            <div className="relative rounded-xl overflow-hidden bg-black border border-[#262b3d]">
              <video ref={videoRef} className="w-full max-h-56 object-cover" muted playsInline />
              <button
                type="button"
                onClick={stopCamera}
                className="absolute top-2 right-2 px-2.5 py-1 rounded-md bg-black/75 text-white text-xs cursor-pointer"
              >
                Stop Camera
              </button>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-[11px] font-mono uppercase tracking-wider text-gray-400">
              Pairing QR Code / URI
            </label>
            <textarea
              rows={3}
              value={qrTextInput}
              onChange={e => setQrTextInput(e.target.value)}
              placeholder="veyview://pair?v=1&..."
              className="w-full bg-[#0c0e15] border border-[#262b3d] rounded-xl px-3 py-2.5 text-xs font-mono text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-[#E27D12]/60"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => handlePairWithText(qrTextInput)}
              className="px-4 py-2 rounded-lg bg-[#E27D12] hover:bg-[#f08b22] disabled:opacity-50 text-black font-semibold text-xs cursor-pointer"
            >
              {busy ? 'Pairing...' : 'Connect & Pair'}
            </button>

            {supportsBarcodeDetector && !cameraActive && (
              <button
                type="button"
                onClick={handleStartCameraScan}
                className="px-3 py-2 rounded-lg bg-[#1b1f2e] hover:bg-[#24293b] border border-[#2e344b] text-gray-200 text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Scan with Camera</span>
              </button>
            )}

            {supportsBarcodeDetector && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-2 rounded-lg bg-[#1b1f2e] hover:bg-[#24293b] border border-[#2e344b] text-gray-200 text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>From Image</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
