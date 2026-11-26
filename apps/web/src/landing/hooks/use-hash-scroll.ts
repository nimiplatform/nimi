import { useEffect } from 'react';

export function resolveHashTargetId(hash: string): string | null {
  if (!hash.startsWith('#') || hash.length <= 1) {
    return null;
  }

  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

export function scrollHashIntoView(hash: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  const targetId = resolveHashTargetId(hash);
  if (!targetId) {
    return false;
  }

  const target = document.getElementById(targetId);
  if (!target) {
    return false;
  }

  const delegatedId = target.dataset.hashTarget;
  const delegated = delegatedId ? document.getElementById(delegatedId) : null;
  const destination = delegated && delegated.getClientRects().length > 0 ? delegated : target;
  destination.scrollIntoView({ block: 'start', behavior: 'instant' });
  return true;
}

const USER_SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
]);

function scheduleCurrentHashScroll() {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let cancelled = false;
  let frameId = 0;
  let settleTimer = 0;
  let observer: ResizeObserver | null = null;

  const stop = () => {
    if (cancelled) return;
    cancelled = true;
    if (frameId) window.cancelAnimationFrame(frameId);
    if (settleTimer) window.clearTimeout(settleTimer);
    observer?.disconnect();
    observer = null;
    window.removeEventListener('wheel', onUserInteract);
    window.removeEventListener('touchstart', onUserInteract);
    window.removeEventListener('pointerdown', onUserInteract);
    window.removeEventListener('keydown', onUserKeyDown);
  };

  const onUserInteract = () => stop();
  const onUserKeyDown = (event: KeyboardEvent) => {
    if (USER_SCROLL_KEYS.has(event.key)) stop();
  };

  const scroll = () => {
    if (cancelled) return;
    scrollHashIntoView(window.location.hash);
  };

  window.addEventListener('wheel', onUserInteract, { passive: true, once: true });
  window.addEventListener('touchstart', onUserInteract, { passive: true, once: true });
  window.addEventListener('pointerdown', onUserInteract, { passive: true, once: true });
  window.addEventListener('keydown', onUserKeyDown);

  frameId = window.requestAnimationFrame(() => {
    frameId = 0;
    scroll();
  });

  if (typeof ResizeObserver !== 'undefined' && document.body && window.location.hash.length > 1) {
    observer = new ResizeObserver(() => {
      if (cancelled) return;
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        scroll();
      });
    });
    observer.observe(document.body);
    settleTimer = window.setTimeout(stop, 600);
  } else {
    settleTimer = window.setTimeout(stop, 300);
  }

  return stop;
}

export function useHashScroll(enabled: boolean, routeHash?: string) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    let cancelScheduledScroll = scheduleCurrentHashScroll();
    const onHashChange = () => {
      cancelScheduledScroll();
      cancelScheduledScroll = scheduleCurrentHashScroll();
    };

    window.addEventListener('hashchange', onHashChange);
    return () => {
      cancelScheduledScroll();
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [enabled, routeHash]);
}
