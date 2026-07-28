// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// 60Hz-capped wrapper around the Tauri `set_ignore_cursor_events` IPC.
// The underlying IPC must not be invoked more than once
// per ~16.67ms (1000/60). Pointer events on macOS can fire at 60-120Hz
// during drag; calling Tauri once per pointermove would saturate the IPC
// channel and lag the click-through transition.
//
// Algorithm — leading edge fire + trailing edge debounce:
//   - First call goes through immediately if elapsed >= minIntervalMs
//   - Subsequent calls within the window queue with a setTimeout; the
//     LATEST queued value wins (state coalescing)
//   - Same-value calls are deduplicated and never reach the IPC
//
// Test seams (`ipcOverride` / `nowMsFn`) keep the throttle deterministic
// under jsdom + vi.useFakeTimers without monkeypatching Date.now.

import { setIgnoreCursorEvents } from './tauri-commands.js';

/** 1000 / 60 ≈ 16.67ms. Frozen here as a named contract constant (no
 *  scattered float literals in throttle
 *  logic). Tests verify the exported value. */
export const THROTTLED_CURSOR_EVENTS_MIN_INTERVAL_MS = 1000 / 60;

export type ThrottledCursorEventsHandle = {
  /** Update the desired ignore state. Calls the underlying Tauri IPC at
   *  most once per `minIntervalMs`; intermediate calls coalesce so the
   *  last-seen value wins on the trailing edge. Same-value calls are
   *  deduplicated and never trigger an IPC. */
  setIgnore(value: boolean): void;
  /** Force-flush any pending coalesced state. Synchronous; the underlying
   *  IPC is fire-and-forget. Returns the awaited IPC promise (or a
   *  resolved promise if nothing was pending). */
  flush(): Promise<void>;
  /** Cancel any pending timer; subsequent `setIgnore` calls are still
   *  honored. */
  dispose(): void;
};

export type CreateThrottledCursorEventsInputs = {
  /** Minimum interval between IPC calls in milliseconds. Default 60Hz
   *  (~16.67ms). */
  minIntervalMs?: number;
  /** Test seam: override the underlying `setIgnoreCursorEvents` Tauri
   *  command. Default: real Tauri IPC. */
  ipcOverride?: (ignore: boolean) => Promise<void>;
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

export function createThrottledCursorEvents(
  input: CreateThrottledCursorEventsInputs = {},
): ThrottledCursorEventsHandle {
  const minIntervalMs = input.minIntervalMs ?? THROTTLED_CURSOR_EVENTS_MIN_INTERVAL_MS;
  const ipc = input.ipcOverride ?? setIgnoreCursorEvents;
  const nowMs = input.nowMsFn ?? defaultNowMs;

  let lastSentValue: boolean | null = null;
  let lastAttemptAtMs = -Infinity;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingValue: boolean | null = null;
  let inFlightValue: boolean | null = null;
  let disposed = false;

  const fireNow = (value: boolean): Promise<void> => {
    const sentAtMs = nowMs();
    lastAttemptAtMs = sentAtMs;
    inFlightValue = value;
    return Promise.resolve(ipc(value))
      .then(() => {
        lastSentValue = value;
      })
      .finally(() => {
        if (inFlightValue === value) inFlightValue = null;
      });
  };

  const flushPending = (): Promise<void> => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    if (pendingValue === null) return Promise.resolve();
    if (pendingValue === lastSentValue) {
      pendingValue = null;
      return Promise.resolve();
    }
    const value = pendingValue;
    pendingValue = null;
    return fireNow(value);
  };

  return {
    setIgnore(value: boolean): void {
      if (disposed) return;
      const now = nowMs();
      const elapsed = now - lastAttemptAtMs;
      // Dedup against either the last sent OR the currently-pending value.
      const sameAsPending = pendingValue === value;
      const sameAsApplied = lastSentValue === value;
      const sameAsRecentInFlight = inFlightValue === value && elapsed < minIntervalMs;
      if (sameAsPending || sameAsApplied || sameAsRecentInFlight) {
        // If the pending timer would resend the same value as last sent
        // we can clear it (saves a no-op IPC).
        if (pendingValue !== null && pendingValue === lastSentValue) {
          if (pendingTimer !== null) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
          }
          pendingValue = null;
        }
        return;
      }
      if (elapsed >= minIntervalMs && pendingTimer === null) {
        void fireNow(value).catch((error: unknown) => {
          console.warn(`[avatar:shell] set_ignore_cursor_events failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return;
      }
      // Either we're inside the rate-limit window OR a timer is already
      // queued; either way coalesce: latest value wins.
      pendingValue = value;
      if (pendingTimer === null) {
        const remaining = Math.max(0, minIntervalMs - elapsed);
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          void flushPending().catch((error: unknown) => {
            console.warn(`[avatar:shell] set_ignore_cursor_events failed: ${error instanceof Error ? error.message : String(error)}`);
          });
        }, remaining);
      }
    },
    flush(): Promise<void> {
      if (disposed) return Promise.resolve();
      return flushPending();
    },
    dispose(): void {
      disposed = true;
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      pendingValue = null;
      inFlightValue = null;
    },
  };
}
