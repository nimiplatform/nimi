import type { LocalRuntimeSnapshot } from './types';
import { fetchLocalRuntimeSnapshot } from './commands';

export type LocalRuntimePollingOptions = {
  localModelId?: string;
  intervalMs?: number;
  onSnapshot: (snapshot: LocalRuntimeSnapshot) => void;
  onError?: (error: unknown) => void;
};

export function startLocalRuntimePolling(options: LocalRuntimePollingOptions): () => void {
  const intervalMs = Number.isFinite(Number(options.intervalMs)) && Number(options.intervalMs) > 0
    ? Number(options.intervalMs)
    : 5000;
  let cancelled = false;

  const run = async () => {
    if (cancelled) return;
    try {
      const snapshot = await fetchLocalRuntimeSnapshot(options.localModelId);
      if (!cancelled) {
        options.onSnapshot(snapshot);
      }
    } catch (error) {
      if (!cancelled && options.onError) {
        options.onError(error);
      }
    }
  };

  void run();
  const timer = setInterval(() => {
    void run();
  }, intervalMs);

  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}
