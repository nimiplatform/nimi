import { useLayoutEffect, useState, type RefObject } from 'react';
import type { NimiPopoverAlign, NimiPopoverSide } from '@nimiplatform/kit/ui/motion';

export type ClampedOverlayPosition = {
  left: number;
  top: number;
  side: NimiPopoverSide;
  align: NimiPopoverAlign;
};

function readViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: 400, height: 600 };
  }
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
}

function clampPosition(value: number, size: number, viewport: number, padding: number): number {
  if (!Number.isFinite(value)) return padding;
  const max = Math.max(padding, viewport - size - padding);
  return Math.max(padding, Math.min(value, max));
}

function computeOverlayPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  padding: number,
): ClampedOverlayPosition {
  const viewport = readViewportSize();
  const left = clampPosition(x, width, viewport.width, padding);
  const top = clampPosition(y, height, viewport.height, padding);
  const safeX = Number.isFinite(x) ? x : padding;
  const safeY = Number.isFinite(y) ? y : padding;
  const side: NimiPopoverSide = top < safeY - 8 ? 'top' : 'bottom';
  const align: NimiPopoverAlign = left < safeX - 8 ? 'end' : 'start';
  return { left, top, side, align };
}

export function useClampedOverlayPosition(input: {
  x: number;
  y: number;
  fallbackWidth: number;
  fallbackHeight: number;
  padding: number;
  rootRef: RefObject<HTMLElement | null>;
}): ClampedOverlayPosition {
  const { x, y, fallbackWidth, fallbackHeight, padding, rootRef } = input;
  const [position, setPosition] = useState<ClampedOverlayPosition>(() =>
    computeOverlayPosition(x, y, fallbackWidth, fallbackHeight, padding),
  );

  useLayoutEffect(() => {
    const recompute = (): void => {
      const element = rootRef.current;
      // Measure unscaled layout size (offsetWidth/offsetHeight) so spring
      // entrance `transform: scale(0.96)` never under-reports box dimensions
      // and causes right/bottom-edge overhang once settled at scale(1).
      const measuredWidth = element?.offsetWidth ?? 0;
      const measuredHeight = element?.offsetHeight ?? 0;
      const rect = measuredWidth > 0 && measuredHeight > 0 ? null : element?.getBoundingClientRect();
      const width = measuredWidth > 0 ? measuredWidth : (rect && rect.width > 0 ? rect.width : fallbackWidth);
      const height = measuredHeight > 0 ? measuredHeight : (rect && rect.height > 0 ? rect.height : fallbackHeight);
      const next = computeOverlayPosition(x, y, width, height, padding);
      setPosition((current) =>
        current.left === next.left
        && current.top === next.top
        && current.side === next.side
        && current.align === next.align
          ? current
          : next,
      );
    };

    recompute();
    window.addEventListener('resize', recompute);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && rootRef.current) {
      observer = new ResizeObserver(recompute);
      observer.observe(rootRef.current);
    }
    return () => {
      window.removeEventListener('resize', recompute);
      observer?.disconnect();
    };
  }, [x, y, fallbackWidth, fallbackHeight, padding, rootRef]);

  return position;
}
