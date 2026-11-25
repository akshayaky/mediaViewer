import { invoke } from '@tauri-apps/api/core';

// In-memory cache for captured video frames (keyed by filePath:roundedSeconds)
const frameCache = new Map<string, string>();
const MAX_FRAME_CACHE_ENTRIES = 160;

function setCachedFrame(cacheKey: string, dataUrl: string): void {
  if (frameCache.has(cacheKey)) {
    frameCache.delete(cacheKey);
  } else if (frameCache.size >= MAX_FRAME_CACHE_ENTRIES) {
    const oldestKey = frameCache.keys().next().value;
    if (oldestKey !== undefined) {
      frameCache.delete(oldestKey);
    }
  }
  frameCache.set(cacheKey, dataUrl);
}

/**
 * Returns a cached frame if available synchronously, otherwise null.
 */
export function getCachedVideoFrame(filePath?: string, positionSeconds?: number): string | null {
  if (!filePath || positionSeconds === undefined || positionSeconds < 0) return null;
  const roundedTime = Math.floor(positionSeconds);
  return frameCache.get(`${filePath}:${roundedTime}`) || null;
}

function drawThumbnailFromVideo(video: HTMLVideoElement, maxWidth?: number): string | null {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  if (vw <= 0 || vh <= 0) return null;

  let width = vw;
  let height = vh;
  if (maxWidth && vw > maxWidth) {
    width = maxWidth;
    height = Math.max(1, Math.round((vh * maxWidth) / vw));
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', maxWidth ? 0.78 : 0.85);
}

export interface VideoFramePreviewSession {
  requestFrame: (positionSeconds: number) => Promise<string | null>;
  dispose: () => void;
}

/**
 * Creates a reusable, latest-wins video frame extractor for progress-bar hover previews.
 */
export function createVideoFramePreviewSession(
  sourceUrl: string,
  filePath: string
): VideoFramePreviewSession {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !sourceUrl) {
    return {
      requestFrame: async () => null,
      dispose: () => {}
    };
  }

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;

  let disposed = false;
  let hasError = false;
  let metadataLoaded = false;
  let isProcessing = false;

  const readyWaiters: Array<() => void> = [];
  let pendingRequest: {
    positionSeconds: number;
    roundedTime: number;
    resolvers: Array<(frame: string | null) => void>;
  } | null = null;

  const resolveReadyWaiters = () => {
    while (readyWaiters.length > 0) {
      const resolve = readyWaiters.shift();
      resolve?.();
    }
  };

  const onLoadedMetadata = () => {
    metadataLoaded = true;
    resolveReadyWaiters();
  };

  const onError = () => {
    hasError = true;
    resolveReadyWaiters();
    if (pendingRequest) {
      const resolvers = pendingRequest.resolvers;
      pendingRequest = null;
      resolvers.forEach(r => r(null));
    }
  };

  video.addEventListener('loadedmetadata', onLoadedMetadata);
  video.addEventListener('error', onError);
  video.src = sourceUrl;

  const waitForMetadata = (): Promise<boolean> => {
    if (disposed || hasError) return Promise.resolve(false);
    if (metadataLoaded) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve(metadataLoaded && !disposed && !hasError);
      }, 4000);
      readyWaiters.push(() => {
        clearTimeout(timeoutId);
        resolve(metadataLoaded && !disposed && !hasError);
      });
    });
  };

  const seekAndCapture = (targetSeconds: number): Promise<string | null> => {
    if (disposed || hasError) return Promise.resolve(null);
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : targetSeconds;
    const clampedTarget = Math.min(Math.max(0, targetSeconds), Math.max(0, dur - 0.05));

    const captureCurrent = (): string | null => {
      try {
        return drawThumbnailFromVideo(video, 320);
      } catch (err) {
        console.warn('[videoFrameCapture] Failed to draw hover preview frame:', err);
        return null;
      }
    };

    if (Math.abs(video.currentTime - clampedTarget) < 0.05 && video.readyState >= 2) {
      return Promise.resolve(captureCurrent());
    }

    return new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (result: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        video.removeEventListener('seeked', handleSeeked);
        video.removeEventListener('error', handleSeekError);
        resolve(result);
      };

      const handleSeeked = () => finish(captureCurrent());
      const handleSeekError = () => {
        hasError = true;
        finish(null);
      };

      const timeoutId = setTimeout(() => finish(null), 2500);
      video.addEventListener('seeked', handleSeeked, { once: true });
      video.addEventListener('error', handleSeekError, { once: true });

      try {
        video.currentTime = clampedTarget;
      } catch {
        finish(null);
      }
    });
  };

  const processQueue = async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      while (pendingRequest && !disposed && !hasError) {
        const current = pendingRequest;
        pendingRequest = null;

        const cacheKey = `${filePath}:${current.roundedTime}`;
        const cached = frameCache.get(cacheKey);
        if (cached) {
          current.resolvers.forEach(r => r(cached));
          continue;
        }

        const ready = await waitForMetadata();
        if (!ready || disposed || hasError) {
          current.resolvers.forEach(r => r(null));
          continue;
        }

        // If a newer hover target arrived while waiting for metadata, skip stale work
        if (pendingRequest) {
          current.resolvers.forEach(r => r(null));
          continue;
        }

        const frame = await seekAndCapture(current.positionSeconds);
        if (frame) {
          setCachedFrame(cacheKey, frame);
        }
        current.resolvers.forEach(r => r(frame));
      }
    } finally {
      isProcessing = false;
    }
  };

  return {
    requestFrame: (positionSeconds: number) => {
      if (disposed || hasError || !Number.isFinite(positionSeconds) || positionSeconds < 0) {
        return Promise.resolve(null);
      }

      const roundedTime = Math.floor(positionSeconds);
      const cacheKey = `${filePath}:${roundedTime}`;
      const cached = frameCache.get(cacheKey);
      if (cached) {
        return Promise.resolve(cached);
      }

      return new Promise<string | null>((resolve) => {
        if (pendingRequest) {
          // Drop stale pending resolvers so only the latest hovered timestamp matters
          const staleResolvers = pendingRequest.resolvers;
          pendingRequest = {
            positionSeconds,
            roundedTime,
            resolvers: [resolve]
          };
          staleResolvers.forEach(r => r(null));
        } else {
          pendingRequest = {
            positionSeconds,
            roundedTime,
            resolvers: [resolve]
          };
        }
        void processQueue();
      });
    },
    dispose: () => {
      disposed = true;
      resolveReadyWaiters();
      if (pendingRequest) {
        const resolvers = pendingRequest.resolvers;
        pendingRequest = null;
        resolvers.forEach(r => r(null));
      }
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onError);
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  };
}

/**
 * Extracts a frame from a local video file at the specified timestamp in seconds.
 * Returns a data URL (image/jpeg) or null if extraction fails.
 */
export async function captureVideoFrameAtTime(
  filePath: string,
  positionSeconds: number
): Promise<string | null> {
  if (!filePath || positionSeconds <= 0) return null;

  const roundedTime = Math.floor(positionSeconds);
  const cacheKey = `${filePath}:${roundedTime}`;
  const cached = frameCache.get(cacheKey);
  if (cached) return cached;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  let streamUrl: string;
  try {
    // Only available in Tauri runtime
    if (!(window as any).__TAURI_INTERNALS__) {
      return null;
    }
    streamUrl = await invoke<string>('get_video_stream_url', { filePath });
  } catch (error) {
    console.warn('[videoFrameCapture] Failed to get video stream URL:', error);
    return null;
  }

  return new Promise<string | null>((resolve) => {
    let hasResolved = false;
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';

    const cleanup = () => {
      clearTimeout(timeoutId);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    const done = (result: string | null) => {
      if (hasResolved) return;
      hasResolved = true;
      cleanup();
      resolve(result);
    };

    // Safety timeout: 4 seconds maximum
    const timeoutId = setTimeout(() => {
      done(null);
    }, 4000);

    const onSeeked = () => {
      try {
        const dataUrl = drawThumbnailFromVideo(video);
        if (dataUrl) {
          setCachedFrame(cacheKey, dataUrl);
        }
        done(dataUrl);
      } catch (err) {
        console.warn('[videoFrameCapture] Failed to draw frame to canvas:', err);
        done(null);
      }
    };

    const onLoadedMetadata = () => {
      try {
        const targetTime = Math.min(positionSeconds, Math.max(0, (video.duration || positionSeconds) - 0.5));
        video.currentTime = targetTime;
      } catch {
        done(null);
      }
    };

    const onError = () => {
      done(null);
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });

    video.src = streamUrl;
  });
}

/**
 * Clears the video frame cache (useful during library rescans or memory cleanup).
 */
export function clearVideoFrameCache(): void {
  frameCache.clear();
}
