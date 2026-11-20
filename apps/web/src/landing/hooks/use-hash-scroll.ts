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
  destination.scrollIntoView({ block: 'start' });
  return true;
}

function scheduleCurrentHashScroll() {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const scroll = () => {
    scrollHashIntoView(window.location.hash);
  };
  const frameId = window.requestAnimationFrame(scroll);
  const timeoutId = window.setTimeout(scroll, 450);
  const settleId = window.setTimeout(scroll, 950);

  return () => {
    window.cancelAnimationFrame(frameId);
    window.clearTimeout(timeoutId);
    window.clearTimeout(settleId);
  };
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
