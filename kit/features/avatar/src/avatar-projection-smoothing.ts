import type { AvatarActivityFallbackBundle, EmbodimentProjectionApi, ProjectionBounds } from './avatar-cue-projection.js';

export const PROJECTION_SIGNAL_SMOOTHING_MAX_PENDING_SIGNALS = 64;

export type ProjectionSmoothingStats = {
  pendingSignalCount: number;
  flushCount: number;
  coalescedSetCount: number;
  coalescedAddCount: number;
};

export type ProjectionSmoothingHandle<TBundle extends AvatarActivityFallbackBundle = AvatarActivityFallbackBundle> = {
  projection: EmbodimentProjectionApi<TBundle>;
  flush(): void;
  dispose(): void;
  getStats(): ProjectionSmoothingStats;
};

export type CreateSmoothedProjectionInput<TBundle extends AvatarActivityFallbackBundle = AvatarActivityFallbackBundle> = {
  projection: EmbodimentProjectionApi<TBundle>;
  requestFlush?: (callback: () => void) => () => void;
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

export function createSmoothedProjection<TBundle extends AvatarActivityFallbackBundle = AvatarActivityFallbackBundle>(
  input: CreateSmoothedProjectionInput<TBundle>,
): ProjectionSmoothingHandle<TBundle> {
  const base = input.projection;
  const requestFlush = input.requestFlush ?? defaultRequestFlush;
  const pendingSignals = new Map<string, PendingSignal>();
  let cancelRequestedFlush: (() => void) | null = null;
  let disposed = false;
  let flushCount = 0;
  let coalescedSetCount = 0;
  let coalescedAddCount = 0;

  const clearRequestedFlush = (): void => {
    if (cancelRequestedFlush) {
      cancelRequestedFlush();
      cancelRequestedFlush = null;
    }
  };

  const scheduleFlush = (): void => {
    if (disposed || cancelRequestedFlush) return;
    cancelRequestedFlush = requestFlush(() => {
      cancelRequestedFlush = null;
      flush();
    });
  };

  const setPendingSignal = (signalId: string, value: number, weight: number): void => {
    if (pendingSignals.has(signalId)) {
      coalescedSetCount += 1;
    }
    pendingSignals.set(signalId, { kind: 'set', value, weight });
  };

  const addPendingSignal = (signalId: string, delta: number): void => {
    const existing = pendingSignals.get(signalId);
    if (existing?.kind === 'set') {
      coalescedAddCount += 1;
      pendingSignals.set(signalId, {
        kind: 'set',
        value: existing.value + delta,
        weight: existing.weight,
      });
      return;
    }
    if (existing?.kind === 'add') {
      coalescedAddCount += 1;
      pendingSignals.set(signalId, { kind: 'add', delta: existing.delta + delta });
      return;
    }
    pendingSignals.set(signalId, { kind: 'add', delta });
  };

  function flush(): void {
    clearRequestedFlush();
    if (pendingSignals.size === 0) return;
    const pending = Array.from(pendingSignals.entries());
    pendingSignals.clear();
    flushCount += 1;
    for (const [signalId, signal] of pending) {
      if (signal.kind === 'set') {
        base.setSignal(signalId, signal.value, signal.weight);
      } else {
        base.addSignal(signalId, signal.delta);
      }
    }
  }

  const flushBefore = <T>(callback: () => T): T => {
    flush();
    return callback();
  };

  const projection: EmbodimentProjectionApi<TBundle> = {
    triggerMotion(motionId, opts) {
      return flushBefore(() => base.triggerMotion(motionId, opts));
    },
    stopMotion() {
      flushBefore(() => base.stopMotion());
    },
    setSignal(signalId, value, weight = 1) {
      if (disposed) return;
      if (pendingSignals.size >= PROJECTION_SIGNAL_SMOOTHING_MAX_PENDING_SIGNALS && !pendingSignals.has(signalId)) {
        flush();
      }
      setPendingSignal(signalId, value, weight);
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
      if (pendingSignals.size >= PROJECTION_SIGNAL_SMOOTHING_MAX_PENDING_SIGNALS && !pendingSignals.has(signalId)) {
        flush();
      }
      addPendingSignal(signalId, delta);
      scheduleFlush();
    },
    setExpression(expressionId) {
      return flushBefore(() => base.setExpression(expressionId));
    },
    clearExpression() {
      flushBefore(() => base.clearExpression());
    },
    setPose(poseId, loop) {
      flushBefore(() => base.setPose(poseId, loop));
    },
    clearPose() {
      flushBefore(() => base.clearPose());
    },
    wait(ms) {
      return flushBefore(() => base.wait(ms));
    },
    getSurfaceBounds(): ProjectionBounds {
      return base.getSurfaceBounds();
    },
    runDefaultActivity(activityId, options) {
      return flushBefore(() => {
        if (!base.runDefaultActivity) {
          return Promise.resolve();
        }
        return base.runDefaultActivity(activityId, options);
      });
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
    getStats() {
      return {
        pendingSignalCount: pendingSignals.size,
        flushCount,
        coalescedSetCount,
        coalescedAddCount,
      };
    },
  };
}
