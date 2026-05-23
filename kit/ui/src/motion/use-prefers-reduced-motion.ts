import { useEffect, useState } from 'react';

/**
 * React hook for `(prefers-reduced-motion: reduce)` media query.
 *
 * Returns `true` when the OS-level reduce-motion preference is set.
 * SSR-safe (returns `false` when `window`/`matchMedia` unavailable).
 *
 * Wave-b fork F1 lift-the-bar: provides a single canonical hook so
 * features no longer reimplement matchMedia subscription per
 * component. Consumes the WCAG SC 2.3.3 / OS-level preference.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (event: MediaQueryListEvent) => {
      setPrefersReduced(event.matches);
    };
    // Some legacy browsers ship `addListener`/`removeListener` instead
    // of the modern `addEventListener('change', ...)` interface.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    const legacy = mq as unknown as {
      addListener?: (h: (e: MediaQueryListEvent) => void) => void;
      removeListener?: (h: (e: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener?.(handler);
    return () => legacy.removeListener?.(handler);
  }, []);

  return prefersReduced;
}
