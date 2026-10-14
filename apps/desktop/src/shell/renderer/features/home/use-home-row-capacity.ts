import { useCallback, useRef, useState } from 'react';

/**
 * Measures how many fixed-width tiles fit one row of the observed container,
 * so Home sections can render a single row and route the overflow to their
 * full destination. A callback ref attaches the observer when the row element
 * actually mounts — the row may render only after async data arrives, which a
 * mount-effect ref would miss.
 */
export function useHomeRowCapacity({
  tileWidth,
  tileGap,
  limit,
}: {
  tileWidth: number;
  tileGap: number;
  limit: number;
}): { ref: (node: HTMLDivElement | null) => void; capacity: number } {
  const [capacity, setCapacity] = useState(limit);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node || typeof ResizeObserver !== 'function') return;
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const fits = Math.floor((entry.contentRect.width + tileGap) / (tileWidth + tileGap));
          setCapacity(Math.max(1, Math.min(limit, fits)));
        }
      });
      observer.observe(node);
      observerRef.current = observer;
    },
    [limit, tileGap, tileWidth],
  );
  return { ref, capacity };
}
