type PollingEnvironment = {
  schedule: (callback: () => void, delay: number) => unknown;
  cancel: (timer: unknown) => void;
  visible: () => boolean;
  onWake: (callback: () => void) => () => void;
};

const browserEnvironment: PollingEnvironment = {
  schedule: (callback, delay) => window.setTimeout(callback, delay),
  cancel: (timer) => window.clearTimeout(timer as number),
  visible: () => document.visibilityState !== 'hidden',
  onWake(callback) {
    const wake = () => { if (document.visibilityState !== 'hidden') callback(); };
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => { window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
  },
};

// Poll active visible transfers promptly, but do not keep idle windows doing
// owner reads every two seconds. Focus always refreshes the current owner.
export function startDownloadPolling(
  refresh: () => Promise<void>,
  hasActiveJobs: () => boolean,
  environment: PollingEnvironment = browserEnvironment,
): { stop: () => void; wake: () => void } {
  let disposed = false;
  let reading = false;
  let wakePending = false;
  let timer: unknown;
  const poll = async () => {
    if (disposed) return;
    if (reading) { wakePending = true; return; }
    if (timer !== undefined) environment.cancel(timer);
    timer = undefined;
    reading = true;
    try { await refresh(); }
    finally {
      reading = false;
      if (!disposed) {
        const delay = wakePending ? 0 : environment.visible() && hasActiveJobs() ? 2_000 : 30_000;
        wakePending = false;
        timer = environment.schedule(() => void poll(), delay);
      }
    }
  };
  const unlisten = environment.onWake(() => void poll());
  void poll();
  return {
    wake: () => void poll(),
    stop: () => { disposed = true; unlisten(); if (timer !== undefined) environment.cancel(timer); },
  };
}
