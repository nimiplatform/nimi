import type { LocalAiRuntimeSnapshot } from './types';
import { fetchLocalAiRuntimeSnapshot } from './commands';

export type LocalAiRuntimePollingOptions = {
  localModelId?: string;
  intervalMs?: number;
  onSnapshot: (snapshot: LocalAiRuntimeSnapshot) => void;
  onError?: (error: unknown) => void;
};

export function startLocalAiRuntimePolling(options: LocalAiRuntimePollingOptions): () => void {
  const intervalMs = Number.isFinite(Number(options.intervalMs)) && Number(options.intervalMs) > 0
    ? Number(options.intervalMs)
    : 5000;
  let cancelled = false;

  const run = async () => {
    if (cancelled) return;
    try {
      const snapshot = await fetchLocalAiRuntimeSnapshot(options.localModelId);
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
