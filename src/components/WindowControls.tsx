import React, { useEffect, useState, useCallback } from 'react';
import { Minus, X } from 'lucide-react';

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

export const WindowControls: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  const checkMaximized = useCallback(async () => {
    if (!isTauri || isAndroid) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const max = await invoke<boolean>('is_window_maximized');
      setIsMaximized(Boolean(max));
    } catch {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const max = await getCurrentWindow().isMaximized();
        setIsMaximized(Boolean(max));
      } catch {
        // Ignored
      }
    }
  }, []);

  useEffect(() => {
    if (!isTauri || isAndroid) return;
    let unlisten: (() => void) | undefined;

    void checkMaximized();

    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        win
          .onResized(() => {
            void checkMaximized();
          })
          .then(fn => {
            unlisten = fn;
          })
          .catch(() => {});
      })
      .catch(() => {});

    return () => {
      if (unlisten) unlisten();
    };
  }, [checkMaximized]);

  if (!isTauri || isAndroid) {
    return null;
  }

  const handleMinimize = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('minimize_window');
    } catch {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().minimize();
      } catch (err) {
        console.warn('Failed to minimize window:', err);
      }
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('toggle_maximize_window');
      void checkMaximized();
    } catch {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().toggleMaximize();
        void checkMaximized();
      } catch (err) {
        console.warn('Failed to toggle maximize window:', err);
      }
    }
  };

  const handleClose = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('close_window');
    } catch {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
      } catch (err) {
        console.warn('Failed to close window:', err);
      }
    }
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 h-8 z-40 flex items-center justify-between pointer-events-none select-none"
      data-tauri-drag-region
    >
      {/* Draggable empty area across the window */}
      <div className="flex-1 h-full" data-tauri-drag-region />

      {/* Top Right Window Control Buttons */}
      <div className="flex items-center h-full pointer-events-auto">
        <button
          type="button"
          onClick={handleMinimize}
          className="h-full w-11 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 active:bg-white/15 transition-colors cursor-pointer"
          title="Minimize"
          aria-label="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={handleToggleMaximize}
          className="h-full w-11 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 active:bg-white/15 transition-colors cursor-pointer"
          title={isMaximized ? 'Restore Down' : 'Maximize'}
          aria-label={isMaximized ? 'Restore Down' : 'Maximize'}
        >
          {isMaximized ? (
            <div className="relative w-3.5 h-3.5 flex items-center justify-center">
              <div className="absolute top-[1px] right-[1px] w-2.5 h-2.5 border border-current rounded-[1px]" />
              <div className="absolute bottom-[1px] left-[1px] w-2.5 h-2.5 border border-current bg-[#0c0d10] rounded-[1px]" />
            </div>
          ) : (
            <div className="w-2.5 h-2.5 border border-current rounded-[1px]" />
          )}
        </button>

        <button
          type="button"
          onClick={handleClose}
          className="h-full w-11 flex items-center justify-center text-gray-400 hover:text-white hover:bg-[#e81123] active:bg-[#c4101f] transition-colors cursor-pointer"
          title="Close"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
