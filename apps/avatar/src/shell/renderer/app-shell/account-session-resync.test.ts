import { describe, expect, it, vi } from 'vitest';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/wire-types';
import { consumeAvatarAccountSessionWithResync } from './account-session-resync.js';

function snapshot(sequence: string) {
  return {
    state: AccountSessionState.AUTHENTICATED,
    sequence,
  };
}

describe('Avatar account session resync', () => {
  it('reopens only the account stream from a fresh Runtime snapshot after transport failure', async () => {
    const controller = new AbortController();
    async function* failedStream() {
      throw Object.assign(new Error('transport unavailable'), { reasonCode: 'RUNTIME_UNAVAILABLE' });
    }
    async function* recoveredStream() {
      yield { snapshot: snapshot('12') };
    }
    const subscribe = vi.fn()
      .mockImplementationOnce(() => failedStream())
      .mockImplementationOnce(() => recoveredStream());
    const getSnapshot = vi.fn(async () => snapshot('11'));
    const unavailable = vi.fn();
    const recovered = vi.fn((value: { sequence: string }) => {
      if (value.sequence === '12') controller.abort();
    });

    await consumeAvatarAccountSessionWithResync({
      runtime: {
        ready: vi.fn(async () => ({})) as never,
        session: { getSnapshot, subscribe },
      } as never,
      initialSnapshot: snapshot('10') as never,
      signal: controller.signal,
      classifySnapshot() { return null; },
      onUnavailable: unavailable,
      onRecovered: recovered,
      retryDelaysMs: [0],
    });

    expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'runtime_account_stream_unavailable',
      retryable: true,
    }));
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls.map(([afterSequence]) => afterSequence)).toEqual(['10', '11']);
    expect(recovered.mock.calls.map(([value]) => value.sequence)).toEqual(['11', '12']);
  });
});
