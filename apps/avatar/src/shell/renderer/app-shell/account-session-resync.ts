import type { NimiBundledAvatarRuntimeClient } from '@nimiplatform/sdk/runtime';
import type { AccountSessionSnapshot } from '@nimiplatform/sdk/runtime/wire-types';

export type AvatarAccountSessionFailure = {
  readonly status: 'unavailable' | 'expired' | 'stale';
  readonly reason: string;
  readonly actionHint: string;
  readonly retryable: boolean;
};

type AccountSessionRuntime = Pick<NimiBundledAvatarRuntimeClient, 'ready' | 'session'>;

const DEFAULT_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000] as const;

export async function consumeAvatarAccountSessionWithResync(input: {
  readonly runtime: AccountSessionRuntime;
  readonly initialSnapshot: AccountSessionSnapshot;
  readonly expectedAccountId: string;
  readonly signal: AbortSignal;
  readonly classifySnapshot: (snapshot: AccountSessionSnapshot) => {
    readonly accountId: string;
    readonly failure: AvatarAccountSessionFailure | null;
  };
  readonly onUnavailable: (input: AvatarAccountSessionFailure & {
    readonly stage: 'account_session_stream' | 'account_session_resync';
    readonly reasonCode?: string | null;
  }) => void;
  readonly onRecovered: (snapshot: AccountSessionSnapshot) => void;
  readonly retryDelaysMs?: readonly number[];
}): Promise<void> {
  const delays = input.retryDelaysMs?.length ? input.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS;
  let afterSequence = input.initialSnapshot.sequence;
  let retryAttempt = 0;

  while (!input.signal.aborted) {
    try {
      const stream = input.runtime.session.subscribe(afterSequence, { signal: input.signal });
      for await (const event of stream) {
        if (input.signal.aborted) return;
        if (!event.snapshot) continue;
        const projection = input.classifySnapshot(event.snapshot);
        afterSequence = event.snapshot.sequence;
        if (projection.accountId && projection.accountId !== input.expectedAccountId) {
          input.onUnavailable({
            status: 'unavailable',
            reason: 'runtime_account_switched',
            actionHint: 'relaunch_avatar_from_desktop',
            retryable: false,
            stage: 'account_session_stream',
          });
          return;
        }
        if (projection.failure) {
          input.onUnavailable({ ...projection.failure, stage: 'account_session_stream' });
        } else {
          retryAttempt = 0;
          input.onRecovered(event.snapshot);
        }
      }
      if (input.signal.aborted) return;
      throw new Error('Avatar account session stream closed unexpectedly.');
    } catch (error) {
      if (input.signal.aborted) return;
      input.onUnavailable({
        status: 'unavailable',
        reason: 'runtime_account_stream_unavailable',
        reasonCode: readReasonCode(error),
        actionHint: 'reconnect_desktop_supervised_avatar_session',
        retryable: true,
        stage: 'account_session_stream',
      });
    }

    while (!input.signal.aborted) {
      await abortableDelay(
        delays[Math.min(retryAttempt, delays.length - 1)] ?? DEFAULT_RETRY_DELAYS_MS.at(-1)!,
        input.signal,
      );
      if (input.signal.aborted) return;
      retryAttempt += 1;
      try {
        await input.runtime.ready({ signal: input.signal });
        const snapshot = await input.runtime.session.getSnapshot({ signal: input.signal });
        const projection = input.classifySnapshot(snapshot);
        if (projection.accountId && projection.accountId !== input.expectedAccountId) {
          input.onUnavailable({
            status: 'unavailable',
            reason: 'runtime_account_switched',
            actionHint: 'relaunch_avatar_from_desktop',
            retryable: false,
            stage: 'account_session_resync',
          });
          return;
        }
        if (projection.failure || !projection.accountId) {
          const failure = projection.failure ?? {
            status: 'unavailable' as const,
            reason: 'runtime_account_projection_unavailable',
            actionHint: 'repair_runtime_account_session',
            retryable: true,
          };
          input.onUnavailable({ ...failure, stage: 'account_session_resync' });
          if (!failure.retryable) return;
          continue;
        }
        afterSequence = snapshot.sequence;
        retryAttempt = 0;
        input.onRecovered(snapshot);
        break;
      } catch (error) {
        if (input.signal.aborted) return;
        input.onUnavailable({
          status: 'unavailable',
          reason: 'runtime_account_resync_unavailable',
          reasonCode: readReasonCode(error),
          actionHint: 'wait_for_runtime_reconnect',
          retryable: true,
          stage: 'account_session_resync',
        });
      }
    }
  }
}

function readReasonCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const value = (error as Record<string, unknown>)['reasonCode'];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(finish, ms);
    function finish() {
      globalThis.clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}
