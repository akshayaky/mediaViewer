import React, { PointerEvent, ReactNode, useRef } from 'react';

interface HorizontalDragScrollProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}

interface DragState {
  pointerId: number;
  startX: number;
  startScrollLeft: number;
  moved: boolean;
  cursor: string;
  userSelect: string;
}

export const HorizontalDragScroll = React.forwardRef<HTMLDivElement, HorizontalDragScrollProps>(
  ({ children, className = '', style, onScroll }, forwardedRef) => {
    const dragStateRef = useRef<DragState | null>(null);
    const suppressClickRef = useRef(false);
    const clearSuppressedClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => () => {
      if (clearSuppressedClickTimerRef.current) clearTimeout(clearSuppressedClickTimerRef.current);
    }, []);

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
      // For mouse, only allow main button (left click)
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      const container = event.currentTarget;
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startScrollLeft: container.scrollLeft,
        moved: false,
        cursor: container.style.cursor,
        userSelect: container.style.userSelect
      };
    };

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const delta = event.clientX - drag.startX;
      if (!drag.moved && Math.abs(delta) < 5) return;

      if (!drag.moved && !event.currentTarget.hasPointerCapture(event.pointerId)) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // pointer capture unsupported in certain mock or test environments
        }
      }

      drag.moved = true;
      event.currentTarget.style.cursor = 'grabbing';
      event.currentTarget.style.userSelect = 'none';
      event.currentTarget.scrollLeft = drag.startScrollLeft - delta;
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    const handlePointerUp = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }

      dragStateRef.current = null;
      event.currentTarget.style.cursor = drag.cursor;
      event.currentTarget.style.userSelect = drag.userSelect;

      if (!drag.moved || cancelled) return;

      suppressClickRef.current = true;
      if (clearSuppressedClickTimerRef.current) clearTimeout(clearSuppressedClickTimerRef.current);
      clearSuppressedClickTimerRef.current = setTimeout(() => {
        suppressClickRef.current = false;
        clearSuppressedClickTimerRef.current = null;
      }, 500);
    };

    const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
      if (!suppressClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
      if (clearSuppressedClickTimerRef.current) {
        clearTimeout(clearSuppressedClickTimerRef.current);
        clearSuppressedClickTimerRef.current = null;
      }
    };

    return (
      <div
        ref={forwardedRef}
        className={`cursor-grab select-none ${className}`}
        style={{ touchAction: 'pan-y', ...style }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={event => handlePointerUp(event, true)}
        onClickCapture={handleClickCapture}
        onScroll={onScroll}
      >
        {children}
      </div>
    );
  }
);

HorizontalDragScroll.displayName = 'HorizontalDragScroll';
