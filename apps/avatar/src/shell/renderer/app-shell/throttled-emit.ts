// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Generic trailing-edge debouncer used to throttle the per-frame
// `onHitRegionChange` consumer callback inside the embodiment-stage. Per
// app-shell-contract.md §2.3.1, the
// hit-region bbox snapshot must not be delivered to the consumer faster
// than 100ms. The carrier surface may emit on every captured frame; the
// embodiment-stage owns the throttle (so the consumer never sees the raw
// per-frame fire rate).
//
// Algorithm — leading edge fire + trailing edge debounce + state coalesce:
//   - First emit fires immediately if elapsed >= minIntervalMs
//   - Subsequent emits within the window queue with a setTimeout; the
//     LATEST queued value wins (state coalescing)
//
// The throttle deliberately does NOT dedupe by value — hit-region payload
// equality is structural, comparing object identities would never dedupe,
// and a deep equality check would be expensive on the hot per-frame path.
// Consumers should be idempotent against same-bbox repeats.

/** 100ms minimum from app-shell-contract.md. Kept as a named constant so
 *  throttle logic contains no scattered float literals. */
export const THROTTLED_EMIT_DEFAULT_MIN_INTERVAL_MS = 100;

export type ThrottledEmitHandle<T> = {
  /** Queue the value for delivery. Calls the consumer callback at most
   *  once per `minIntervalMs`; the latest value wins on the trailing
   *  edge. */
  emit(value: T): void;
  /** Force-flush any pending coalesced value. Synchronous. */
  flush(): void;
  /** Cancel any pending timer; subsequent `emit` calls are still
   *  honored. */
  dispose(): void;
};

export type CreateThrottledEmitInputs<T> = {
  callback: (value: T) => void;
  /** Minimum interval between consumer callback fires in ms. Default
   *  100ms. */
  minIntervalMs?: number;
  /** Test seam: clock source. Default `performance.now()` (or `Date.now`
   *  if `performance` is unavailable). */
  nowMsFn?: () => number;
};

function defaultNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function createThrottledEmit<T>(
  input: CreateThrottledEmitInputs<T>,
): ThrottledEmitHandle<T> {
  const minIntervalMs = input.minIntervalMs ?? THROTTLED_EMIT_DEFAULT_MIN_INTERVAL_MS;
  const callback = input.callback;
  const nowMs = input.nowMsFn ?? defaultNowMs;

  let lastFiredAtMs = -Infinity;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingValue: { value: T } | null = null;
  let disposed = false;

  const fireNow = (value: T): void => {
    lastFiredAtMs = nowMs();
    try {
      callback(value);
    } catch {
      // Consumer threw; intentionally swallow to keep the throttle
      // resilient (the carrier surface emits on the per-frame hot path).
    }
  };

  const flushPending = (): void => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    if (pendingValue === null) return;
    const value = pendingValue.value;
    pendingValue = null;
    fireNow(value);
  };

  return {
    emit(value: T): void {
      if (disposed) return;
      const now = nowMs();
      const elapsed = now - lastFiredAtMs;
      if (elapsed >= minIntervalMs && pendingTimer === null) {
        fireNow(value);
        return;
      }
      pendingValue = { value };
      if (pendingTimer === null) {
        const remaining = Math.max(0, minIntervalMs - elapsed);
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          flushPending();
        }, remaining);
      }
    },
    flush(): void {
      if (disposed) return;
      flushPending();
    },
    dispose(): void {
      disposed = true;
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      pendingValue = null;
    },
  };
}
