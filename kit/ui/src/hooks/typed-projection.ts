import { useCallback, useEffect, useRef, useState } from 'react';

/** Lifecycle of a reusable typed projection load. */
export type TypedProjectionStatus = 'loading' | 'ready' | 'failed';

export interface TypedProjectionState<T> {
  readonly status: TypedProjectionStatus;
  /** Present only when `status === 'ready'`. Never a fabricated default. */
  readonly data: T | null;
  /** Present only when `status === 'failed'`. The typed failure reason. */
  readonly error: string | null;
  /** Re-run the typed load. */
  readonly reload: () => void;
}

export interface TypedProjectionOptions {
  readonly failClosedMessage?: string;
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
 * Failed loads are represented as `status: 'failed'` and never synthesize
 * placeholder data. App surfaces stay responsible for their product rendering.
 */
export function useTypedProjection<T>(
  load: () => Promise<T>,
  options?: TypedProjectionOptions,
): TypedProjectionState<T> {
  const failClosedMessage = options?.failClosedMessage ?? 'Typed projection unavailable';
  const [state, setState] = useState<{
    status: TypedProjectionStatus;
    data: T | null;
    error: string | null;
  }>({ status: 'loading', data: null, error: null });
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

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
