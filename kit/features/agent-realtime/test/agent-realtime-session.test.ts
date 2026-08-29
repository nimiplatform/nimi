import { describe, expect, it, vi } from 'vitest';

import { createNimiAgentRealtimeSession } from '../src/session';
import type {
  NimiAgentRealtimeClient,
  NimiAgentRealtimeEvent,
  NimiAgentRealtimeHostMediaPort,
  NimiLocalAppAgentHandle,
  NimiRealtimeControlStatus,
  NimiRealtimeEventEnvelope,
  NimiRealtimeOperationResult,
  NimiRealtimeSubscription,
} from '../src/types';

const HANDLE = `agent_ref_${'A'.repeat(43)}` as NimiLocalAppAgentHandle;
const AUDIO_FORMAT = Object.freeze({
  codec: 'pcm-s16le' as const,
  sampleRateHz: 16_000,
  channelCount: 1 as const,
  frameDurationMs: 20,
  maximumFrameBytes: 640,
});

describe('canonical Agent Realtime session', () => {
  it('opens without implicit capture, serializes Host frames, honors blocked pressure, and hands output to Host', async () => {
    const stream = createEventStream<NimiRealtimeEventEnvelope<NimiAgentRealtimeEvent>>();
    let captureInput: Parameters<NimiAgentRealtimeHostMediaPort['microphone']['beginCapture']>[0] | null = null;
    const captureStop = vi.fn(async () => undefined);
    const playbackWrite = vi.fn(async () => undefined);
    const host = createHost({
      beginCapture: async (input) => {
        captureInput = input;
        return {
          status: 'ready',
          capture: {
            inputTrackId: 'input-track-1',
            utteranceId: 'utterance-1',
            stop: captureStop,
          },
        };
      },
      writeAudioFrame: playbackWrite,
    });
    const appendInput = vi.fn(async (input: Parameters<NimiAgentRealtimeClient['appendInput']>[0]) => (
      operation(input.input.type === 'capture-stopped' ? control('blocked') : control())
    ));
    const client = createClient({ stream, appendInput });
    const session = createSession(client, host);

    await session.open();
    expect(host.microphone.beginCapture).not.toHaveBeenCalled();

    await expect(session.requestCapture()).resolves.toEqual({ status: 'started' });
    expect(captureInput).not.toBeNull();
    await captureInput!.onFrame({ frameSequence: '1', frame: new Uint8Array([1, 2]) });
    expect(appendInput).toHaveBeenCalledWith(expect.objectContaining({
      agentHandle: HANDLE,
      input: {
        type: 'audio-frame',
        inputTrackId: 'input-track-1',
        utteranceId: 'utterance-1',
        frameSequence: '1',
        frame: new Uint8Array([1, 2]),
      },
    }));

    stream.push({
      control: control(),
      event: {
        type: 'audio-frame',
        requestId: 'request-1',
        outputTrackId: 'output-track-1',
        frameSequence: '1',
        frame: new Uint8Array([0, 0]),
        format: AUDIO_FORMAT,
      },
    });
    await vi.waitFor(() => expect(playbackWrite).toHaveBeenCalledWith({
      outputTrackId: 'output-track-1',
      frameSequence: '1',
      frame: new Uint8Array([0, 0]),
      format: AUDIO_FORMAT,
    }));

    stream.push({
      control: control('blocked'),
      event: {
        type: 'transcript',
        inputTrackId: 'input-track-1',
        utteranceId: 'utterance-1',
        text: 'hello',
        final: false,
      },
    });
    await vi.waitFor(() => expect(captureStop).toHaveBeenCalledTimes(1));
    expect(appendInput).toHaveBeenCalledWith(expect.objectContaining({
      input: {
        type: 'capture-stopped',
        inputTrackId: 'input-track-1',
        utteranceId: 'utterance-1',
      },
    }));
    expect(session.getState().pressure).toBe('blocked');
    expect(session.getState().capture).toBe('stopped');

    await session.close();
  });

  it('fails capture closed on OS denial without sending audio', async () => {
    const stream = createEventStream<NimiRealtimeEventEnvelope<NimiAgentRealtimeEvent>>();
    const appendInput = vi.fn(async () => operation(control()));
    const client = createClient({ stream, appendInput });
    const host = createHost({
      beginCapture: async () => ({ status: 'permission-denied' }),
    });
    const session = createSession(client, host);

    await session.open();
    const result = await session.requestCapture();

    expect(result.status).toBe('permission-denied');
    expect(session.getState().capture).toBe('permission-denied');
    expect(session.getState().error?.reasonCode).toBe(
      'KIT_AGENT_REALTIME_MICROPHONE_PERMISSION_DENIED',
    );
    expect(appendInput).not.toHaveBeenCalled();
    await session.close();
  });

  it('fences a late open result with a new local session epoch and closes the stale Runtime session', async () => {
    const deferred = createDeferred<Awaited<ReturnType<NimiAgentRealtimeClient['open']>>>();
    const client = createClient({
      stream: createEventStream<NimiRealtimeEventEnvelope<NimiAgentRealtimeEvent>>(),
      open: () => deferred.promise,
    });
    const session = createSession(client, createHost());

    const opening = session.open();
    await Promise.resolve();
    await session.close();
    deferred.resolve(openResult());

    await expect(opening).rejects.toMatchObject({
      reasonCode: 'KIT_AGENT_REALTIME_STALE_SESSION_EPOCH',
    });
    expect(client.close).toHaveBeenCalledWith({
      agentHandle: HANDLE,
      realtimeSessionId: 'realtime-session-1',
      generation: '1',
    });
    expect(session.getState().lifecycle).toBe('closed');
  });

  it('preserves a non-closed terminal reason as the typed visible failure', async () => {
    const stream = createEventStream<NimiRealtimeEventEnvelope<NimiAgentRealtimeEvent>>();
    const session = createSession(createClient({ stream }), createHost());
    await session.open();

    stream.push({
      control: control('normal', 'ready'),
      event: { type: 'terminal', reasonCode: 'AGENT_REALTIME_OWNER_FAILED' },
    });

    await vi.waitFor(() => {
      expect(session.getState().lifecycle).toBe('failed');
      expect(session.getState().error?.reasonCode).toBe('AGENT_REALTIME_OWNER_FAILED');
    });
    await session.close();
  });
});

function createSession(
  client: NimiAgentRealtimeClient,
  host: NimiAgentRealtimeHostMediaPort,
) {
  return createNimiAgentRealtimeSession({
    agentRealtime: client,
    agentHandle: HANDLE,
    inputAudio: AUDIO_FORMAT,
    turnDetection: 'server-vad',
    host,
  });
}

function createClient(input: {
  readonly stream: ReturnType<typeof createEventStream<NimiRealtimeEventEnvelope<NimiAgentRealtimeEvent>>>;
  readonly open?: NimiAgentRealtimeClient['open'];
  readonly appendInput?: NimiAgentRealtimeClient['appendInput'];
}): NimiAgentRealtimeClient {
  return {
    open: vi.fn(input.open ?? (async () => openResult())),
    appendInput: vi.fn(input.appendInput ?? (async () => operation(control()))),
    subscribe: vi.fn(async () => input.stream.subscription),
    status: vi.fn(async () => control()),
    interruptOutput: vi.fn(async () => operation(control())),
    close: vi.fn(async () => operation(control('normal', 'closed'))),
  };
}

function createHost(input: {
  readonly beginCapture?: NimiAgentRealtimeHostMediaPort['microphone']['beginCapture'];
  readonly writeAudioFrame?: NimiAgentRealtimeHostMediaPort['playback']['writeAudioFrame'];
} = {}): NimiAgentRealtimeHostMediaPort {
  const beginCapture: NimiAgentRealtimeHostMediaPort['microphone']['beginCapture']
    = input.beginCapture ?? (async () => ({ status: 'device-unavailable' as const }));
  return {
    microphone: {
      beginCapture: vi.fn(beginCapture),
    },
    playback: {
      writeAudioFrame: vi.fn(input.writeAudioFrame ?? (async () => undefined)),
      finishOutputTrack: vi.fn(async () => undefined),
      interruptOutputTrack: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    },
  };
}

function openResult() {
  return {
    conversationAnchorId: 'conversation-anchor-1',
    realtimeSessionId: 'realtime-session-1',
    channelId: 'channel-1',
    generation: '1',
    negotiatedInputAudio: AUDIO_FORMAT,
    negotiatedOutputAudio: AUDIO_FORMAT,
    control: control(),
  } as const;
}

function operation(value: NimiRealtimeControlStatus): NimiRealtimeOperationResult {
  return {
    ack: { ok: true, reasonCode: '', actionHint: '' },
    control: value,
  };
}

function control(
  backpressure: NimiRealtimeControlStatus['backpressure'] = 'normal',
  lifecycle: NimiRealtimeControlStatus['lifecycle'] = 'ready',
): NimiRealtimeControlStatus {
  return {
    realtimeSessionId: 'realtime-session-1',
    channelId: 'channel-1',
    subscriptionId: 'subscription-1',
    adapterKind: 'local-agent',
    lifecycle,
    generation: '1',
    sequence: '1',
    correlationId: 'correlation-1',
    backpressure,
    bufferedItems: backpressure === 'normal' ? 0 : 1,
    bufferCapacity: 1,
    terminalReason: lifecycle === 'closed' ? 'cancelled' : '',
    actionHint: '',
    occurredAt: null,
  };
}

function createEventStream<T>() {
  const queue: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let ended = false;
  const subscription: NimiRealtimeSubscription<NimiAgentRealtimeEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          const value = queue.shift();
          if (value !== undefined) return { done: false as const, value };
          if (ended) return { done: true as const, value: undefined };
          return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve));
        },
      } as AsyncIterator<T>;
    },
    cancel: async () => {
      ended = true;
      for (const resolve of waiters.splice(0)) {
        resolve({ done: true, value: undefined });
      }
    },
  } as NimiRealtimeSubscription<NimiAgentRealtimeEvent>;
  return {
    subscription,
    push(value: T) {
      const resolve = waiters.shift();
      if (resolve) resolve({ done: false, value });
      else queue.push(value);
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
