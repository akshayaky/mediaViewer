import React, { PointerEvent, ReactNode, useRef } from 'react';

interface HorizontalDragScrollProps {
  children: ReactNode;
  className: string;
}

interface DragState {
  pointerId: number;
  startX: number;
  startScrollLeft: number;
  moved: boolean;
  cursor: string;
  userSelect: string;
}

export const HorizontalDragScroll: React.FC<HorizontalDragScrollProps> = ({ children, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const clearSuppressedClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (clearSuppressedClickTimerRef.current) clearTimeout(clearSuppressedClickTimerRef.current);
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
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

    if (!drag.moved && event.currentTarget.hasPointerCapture(event.pointerId) === false) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    drag.moved = true;
    event.currentTarget.style.cursor = 'grabbing';
    event.currentTarget.style.userSelect = 'none';
    event.currentTarget.scrollLeft = drag.startScrollLeft - delta;
    event.preventDefault();
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
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
      ref={containerRef}
      className={`cursor-grab select-none ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={event => handlePointerUp(event, true)}
      onClickCapture={handleClickCapture}
    >
      {children}
    </div>
  );
};
