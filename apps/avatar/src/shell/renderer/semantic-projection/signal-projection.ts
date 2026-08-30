export type AvatarSignalProjection = {
  setSignal(signalId: string, value: number, weight?: number): void;
  getSignal(signalId: string): number;
  addSignal(signalId: string, delta: number): void;
};

export const SIGNAL_PROJECTION_SMOOTHING_MAX_PENDING_SIGNALS = 64;

export type SignalProjectionSmoothingStats = {
  pendingSignalCount: number;
  flushCount: number;
  coalescedSetCount: number;
  coalescedAddCount: number;
};

export type SignalProjectionSmoothingHandle = {
  projection: AvatarSignalProjection;
  flush(): void;
  dispose(): void;
  getStats(): SignalProjectionSmoothingStats;
};

type PendingSignal =
  | { kind: 'set'; value: number; weight: number }
  | { kind: 'add'; delta: number };

function defaultRequestFlush(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const frame = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(frame);
  }
  const timer = setTimeout(callback, 16);
  return () => clearTimeout(timer);
}

export function createSmoothedSignalProjection(input: {
  projection: AvatarSignalProjection;
  requestFlush?: (callback: () => void) => () => void;
}): SignalProjectionSmoothingHandle {
  const base = input.projection;
  const requestFlush = input.requestFlush ?? defaultRequestFlush;
  const pendingSignals = new Map<string, PendingSignal>();
  let cancelRequestedFlush: (() => void) | null = null;
  let disposed = false;
  let flushCount = 0;
  let coalescedSetCount = 0;
  let coalescedAddCount = 0;

  const clearRequestedFlush = (): void => {
    cancelRequestedFlush?.();
    cancelRequestedFlush = null;
  };
  const scheduleFlush = (): void => {
    if (disposed || cancelRequestedFlush) return;
    cancelRequestedFlush = requestFlush(() => {
      cancelRequestedFlush = null;
      flush();
    });
  };

  function flush(): void {
    clearRequestedFlush();
    if (pendingSignals.size === 0) return;
    const pending = [...pendingSignals.entries()];
    pendingSignals.clear();
    flushCount += 1;
    for (const [signalId, signal] of pending) {
      if (signal.kind === 'set') base.setSignal(signalId, signal.value, signal.weight);
      else base.addSignal(signalId, signal.delta);
    }
  }

  const projection: AvatarSignalProjection = {
    setSignal(signalId, value, weight = 1) {
      if (disposed) return;
      if (pendingSignals.size >= SIGNAL_PROJECTION_SMOOTHING_MAX_PENDING_SIGNALS
        && !pendingSignals.has(signalId)) flush();
      if (pendingSignals.has(signalId)) coalescedSetCount += 1;
      pendingSignals.set(signalId, { kind: 'set', value, weight });
      scheduleFlush();
    },
    getSignal(signalId) {
      const pending = pendingSignals.get(signalId);
      if (pending?.kind === 'set') return pending.value;
      if (pending?.kind === 'add') return base.getSignal(signalId) + pending.delta;
      return base.getSignal(signalId);
    },
    addSignal(signalId, delta) {
      if (disposed) return;
      if (pendingSignals.size >= SIGNAL_PROJECTION_SMOOTHING_MAX_PENDING_SIGNALS
        && !pendingSignals.has(signalId)) flush();
      const existing = pendingSignals.get(signalId);
      if (existing?.kind === 'set') {
        coalescedAddCount += 1;
        pendingSignals.set(signalId, {
          kind: 'set', value: existing.value + delta, weight: existing.weight,
        });
      } else if (existing?.kind === 'add') {
        coalescedAddCount += 1;
        pendingSignals.set(signalId, { kind: 'add', delta: existing.delta + delta });
      } else {
        pendingSignals.set(signalId, { kind: 'add', delta });
      }
      scheduleFlush();
    },
  };

  return {
    projection,
    flush,
    dispose() {
      if (disposed) return;
      flush();
      clearRequestedFlush();
      disposed = true;
    },
    getStats: () => ({
      pendingSignalCount: pendingSignals.size,
      flushCount,
      coalescedSetCount,
      coalescedAddCount,
    }),
  };
}
