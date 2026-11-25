import React, { useEffect, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Minus, X } from 'lucide-react';
import './TitleBarDragRegion.css';

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

export interface TitleBarDragRegionProps {
  /** Custom titlebar height (defaults to CSS variable --titlebar-height: 40px) */
  height?: number | string;
  /** Whether to render desktop caption buttons (defaults to true on desktop) */
  showControls?: boolean;
  /** Whether to expose portal target IDs (#titlebar-left, #titlebar-actions-right) */
  enablePortals?: boolean;
  /** Additional container classes */
  className?: string;
  /** Optional mouse move handler */
  onMouseMove?: React.MouseEventHandler<HTMLElement>;
  /** Optional mouse enter handler */
  onMouseEnter?: React.MouseEventHandler<HTMLElement>;
  /** Optional elements to place inside the titlebar */
  children?: React.ReactNode;
}

/**
 * Portal component to project controls (e.g. Back button or 3-dot menu) directly into the
 * top TitleBarDragRegion without being blocked by window dragging or CSS stacking contexts.
 */
export const TitleBarPortal: React.FC<{
  target: 'left' | 'right';
  children: React.ReactNode;
}> = ({ target, children }) => {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const targetId = target === 'left' ? 'titlebar-left' : 'titlebar-actions-right';
    const el = document.getElementById(targetId);
    setContainer(el);
  }, [target]);

  // Fallback for Android or when TitleBarDragRegion is not in DOM: render in place
  if (!container) {
    return <>{children}</>;
  }

  return createPortal(children, container);
};

export const TitleBarDragRegion: React.FC<TitleBarDragRegionProps> = ({
  height,
  showControls = true,
  enablePortals = true,
  className = '',
  onMouseMove,
  onMouseEnter,
  children
}) => {
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
        // Fallback for browser/mock environment
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

  // On Android, native mobile navigation handles everything; skip desktop titlebar drag region
  if (isAndroid) {
    return null;
  }

  const handleMinimize = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleToggleMaximize = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
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

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const dynamicStyles: React.CSSProperties & Record<string, string | number> = {};
  if (height !== undefined) {
    dynamicStyles['--titlebar-height'] = typeof height === 'number' ? `${height}px` : height;
  }

  return (
    <header
      className={`titlebar-drag-region ${className}`}
      style={dynamicStyles}
      data-tauri-drag-region
      onDoubleClick={() => handleToggleMaximize()}
      onContextMenu={(e) => e.preventDefault()}
      onMouseMove={onMouseMove}
      onMouseEnter={onMouseEnter}
    >
      {/* Subtle top gradient scrim (fading from ~40% black to transparent) */}
      <div className="titlebar-scrim" />

      {/* Left slot for Back button */}
      <div
        id={enablePortals ? 'titlebar-left' : undefined}
        className="titlebar-actions-left"
        data-tauri-drag-region="false"
        onMouseDown={(e) => e.stopPropagation()}
      />

      {/* Empty draggable middle area across the window */}
      <div className="titlebar-drag-area" data-tauri-drag-region>
        {children}
      </div>

      {/* Right group: Custom actions (3-dot menu) + Window Controls */}
      <div
        className="titlebar-right-group"
        data-tauri-drag-region="false"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Custom actions slot immediately to the left of window controls */}
        <div
          id={enablePortals ? 'titlebar-actions-right' : undefined}
          className="titlebar-actions-right"
          data-tauri-drag-region="false"
          onMouseDown={(e) => e.stopPropagation()}
        />

        {/* Windows Caption Controls (minimize, maximize, close) */}
        {showControls && (
          <div
            className="titlebar-controls"
            data-tauri-drag-region="false"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={handleMinimize}
              onMouseDown={(e) => e.stopPropagation()}
              className="titlebar-control-btn"
              title="Minimize"
              aria-label="Minimize"
              data-tauri-drag-region="false"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleToggleMaximize}
              onMouseDown={(e) => e.stopPropagation()}
              className="titlebar-control-btn"
              title={isMaximized ? 'Restore Down' : 'Maximize'}
              aria-label={isMaximized ? 'Restore Down' : 'Maximize'}
              data-tauri-drag-region="false"
            >
              {isMaximized ? (
                <svg
                  className="w-3.5 h-3.5 pointer-events-none"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  aria-hidden="true"
                >
                  <rect x="1.5" y="3.5" width="7" height="7" rx="0.75" />
                  <path d="M3.5 3.5V2.25C3.5 1.83579 3.83579 1.5 4.25 1.5H9.75C10.1642 1.5 10.5 1.83579 10.5 2.25V7.75C10.5 8.16421 10.1642 8.5 9.75 8.5H8.5" />
                </svg>
              ) : (
                <div className="w-2.5 h-2.5 border border-current rounded-[1px] pointer-events-none" />
              )}
            </button>

            <button
              type="button"
              onClick={handleClose}
              onMouseDown={(e) => e.stopPropagation()}
              className="titlebar-control-btn btn-close"
              title="Close"
              aria-label="Close"
              data-tauri-drag-region="false"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
