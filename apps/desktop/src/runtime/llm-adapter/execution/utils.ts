export function buildLocalId(prefix: string) {
  return `local:${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export function estimateTokens(text: string) {
  const normalized = String(text || '').trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

export function formatProviderError(error: unknown) {
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return String((error as { message?: unknown }).message || '');
  }
  if (error instanceof Error) return error.message;
  return String(error || '');
}

type ScopedAbortSignal = {
  signal: AbortSignal;
  wasTimedOut: () => boolean;
  wasExternallyAborted: () => boolean;
  dispose: () => void;
};

export function createScopedAbortSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): ScopedAbortSignal {
  const controller = new AbortController();
  let timedOut = false;
  let externallyAborted = false;
  const abort = (source: 'timeout' | 'external') => {
    if (controller.signal.aborted) return;
    if (source === 'timeout') timedOut = true;
    if (source === 'external') externallyAborted = true;
    controller.abort();
  };
  const onExternalAbort = () => {
    abort('external');
  };
  const timer = setTimeout(() => {
    abort('timeout');
  }, Math.max(0, timeoutMs));

  if (externalSignal) {
    if (externalSignal.aborted) {
      abort('external');
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    wasTimedOut: () => timedOut,
    wasExternallyAborted: () => externallyAborted,
    dispose: () => {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}

export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  externalSignal?: AbortSignal,
): Promise<T> {
  const scopedAbort = createScopedAbortSignal(timeoutMs, externalSignal);
  try {
    const result = await run(scopedAbort.signal);
    if (scopedAbort.wasTimedOut()) {
      throw new Error(timeoutMessage);
    }
    if (scopedAbort.wasExternallyAborted()) {
      throw new Error('PLAY_PROVIDER_ABORTED');
    }
    return result;
  } catch (error) {
    if (scopedAbort.wasTimedOut()) {
      throw new Error(timeoutMessage);
    }
    if (scopedAbort.wasExternallyAborted()) {
      throw new Error('PLAY_PROVIDER_ABORTED');
    }
    throw error;
  } finally {
    scopedAbort.dispose();
  }
}
