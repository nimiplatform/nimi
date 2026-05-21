/**
 * Shared typed-projection state for `Support` sub-areas.
 *
 * Every `Support` sub-area consumes an upstream typed projection (product
 * control, desktop release, runtime daemon status, storage dirs). Per
 * `D-SUP-003..007` a missing / failed projection must fail closed into a
 * typed `failed` state — never a synthesized placeholder or pseudo-success.
 * This hook is the single mechanism that enforces that posture.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** Lifecycle of a typed Support projection load. */
export type SupportProjectionStatus = 'loading' | 'ready' | 'failed';

export interface SupportProjectionState<T> {
  readonly status: SupportProjectionStatus;
  /** Present only when `status === 'ready'`. Never a fabricated default. */
  readonly data: T | null;
  /** Present only when `status === 'failed'`. The typed failure reason. */
  readonly error: string | null;
  /** Re-run the typed load. */
  readonly reload: () => void;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  const text = String(error ?? '').trim();
  return text || fallback;
}

/**
 * Load a typed projection and expose a fail-closed lifecycle.
 *
 * On rejection the hook holds `status: 'failed'` with the typed `error`; it
 * does NOT fall back to a default `data`. Sub-areas render their typed failure
 * surface from that state.
 */
export function useSupportProjection<T>(
  load: () => Promise<T>,
  options?: { readonly failClosedMessage?: string },
): SupportProjectionState<T> {
  const failClosedMessage = options?.failClosedMessage ?? 'Support projection unavailable';
  const [state, setState] = useState<{
    status: SupportProjectionStatus;
    data: T | null;
    error: string | null;
  }>({ status: 'loading', data: null, error: null });
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  // `load` is captured into a ref so a caller passing an inline closure does
  // not retrigger the effect on every render — the projection re-runs only on
  // an explicit `reload()` (via `reloadToken`).
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });
    void loadRef.current()
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', data, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Fail closed: a failed typed projection becomes a typed failure
        // state, never a placeholder `data`.
        setState({
          status: 'failed',
          data: null,
          error: toErrorMessage(error, failClosedMessage),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken, failClosedMessage]);

  return { ...state, reload };
}
