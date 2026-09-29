import { useEffect } from 'react';

export function useCheckSyncPolling(running: boolean, refresh: () => Promise<unknown>): void {
  useEffect(() => {
    if (!running) return undefined;
    let pending = false;
    const poll = () => {
      if (pending) return;
      pending = true;
      void refresh().catch(() => undefined).finally(() => { pending = false; });
    };
    const interval = window.setInterval(poll, 1_000);
    const refreshWhenVisible = () => {
      if (!document.hidden) poll();
    };
    const refreshOnFocus = () => poll();
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [running, refresh]);
}
