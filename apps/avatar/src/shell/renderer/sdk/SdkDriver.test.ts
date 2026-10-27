import { describe, expect, it, vi } from 'vitest';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationClient,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationSubscription,
  NimiLocalAppEmbodimentClient,
  NimiLocalAppEmbodimentEvent,
  NimiLocalAppEmbodimentSubscription,
} from '@nimiplatform/sdk/app';
import type { AgentEvent } from '../driver/types.js';
import { SdkDriver, type SdkDriverOptions } from './SdkDriver.js';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle;
const ANCHOR = 'anchor-1';

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
  return { promise, resolve, reject };
}

function voiceReadyEvent(): NimiLocalAppConversationEvent {
  return {
    type: 'voice-ready',
    conversationAnchorId: ANCHOR,
    sequence: '1',
    turnId: 'turn-1',
    voice: {
      voiceId: 'voice-1',
      turnId: 'turn-1',
      messageId: 'message-1',
      state: 'ready',
      artifactId: 'voice-artifact-1',
      reasonCode: null,
      message: null,
    },
  };
}

function voiceArtifact() {
  return {
    artifactId: 'voice-artifact-1',
    bytes: Uint8Array.from([1, 2, 3]),
    mimeType: 'audio/wav',
    byteLength: 3,
  };
}

function conversation(events: readonly NimiLocalAppConversationEvent[]): NimiLocalAppConversationClient {
  let release: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => { release = resolve; });
  const subscription: NimiLocalAppConversationSubscription = Object.assign({
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
      await closed;
    },
  }, {
    async cancel() { release?.(); },
  });
  return {
    async subscribe() { return subscription; },
    async snapshot() {
      return {
        conversationAnchorId: ANCHOR,
        throughSequence: '0',
        turns: [], messages: [], actions: [], voices: [], truncatedBefore: false,
      };
    },
  } as unknown as NimiLocalAppConversationClient;
}

function embodiment(events: readonly NimiLocalAppEmbodimentEvent[] = []): NimiLocalAppEmbodimentClient {
  return {
    async snapshot() {
      return {
        sequence: '1',
        observedAt: { seconds: '1', nanos: 0 },
        provenance: 'runtime_agent_owner',
        activity: null,
        emotion: null,
        posture: null,
        voiceTiming: null,
      };
    },
    async subscribe() {
      let release: (() => void) | undefined;
      const closed = new Promise<void>((resolve) => { release = resolve; });
      return Object.assign({
        async *[Symbol.asyncIterator]() {
          for (const event of events) yield event;
          await closed;
        },
      }, { async cancel() { release?.(); } });
    },
  };
}

function waitingSubscription<T>(cancelled?: Promise<void>) {
  const ended = deferred<void>();
  const next = vi.fn(async (): Promise<IteratorResult<T>> => {
    await ended.promise;
    return { done: true, value: undefined };
  });
  const cancel = vi.fn(async () => { ended.resolve(); await cancelled; });
  return {
    subscription: { cancel, [Symbol.asyncIterator]: () => ({ next }) },
    next,
    cancel,
    end: () => ended.resolve(),
    fail: (error: unknown) => ended.reject(error),
  };
}

function senderInvalidatedError() {
  return Object.assign(new Error('Bundled Avatar sender was invalidated'), {
    reasonCode: 'electron-bundled-avatar-sender-invalidated',
  });
}

describe('SdkDriver canonical App Product Plane', () => {
  it.each(['exact reason', 'message only'] as const)('handles a stream invalidation with %s without weakening other failures', async (kind) => {
    vi.useFakeTimers();
    const conversations: ReturnType<typeof waitingSubscription<NimiLocalAppConversationEvent>>[] = [];
    const embodiments: ReturnType<typeof waitingSubscription<NimiLocalAppEmbodimentEvent>>[] = [];
    const subscribe = vi.fn(async () => {
      const stream = waitingSubscription<NimiLocalAppConversationEvent>(); conversations.push(stream); return stream.subscription;
    });
    const driver = new SdkDriver({
      conversation: { ...conversation([]), subscribe },
      embodiment: { ...embodiment(), subscribe: async () => {
        const stream = waitingSubscription<NimiLocalAppEmbodimentEvent>(); embodiments.push(stream); return stream.subscription;
      } },
      agentHandle: AGENT_HANDLE, conversationAnchorId: ANCHOR, activeWorldId: '', locale: 'en-US',
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await driver.start();
      embodiments[0]!.fail(kind === 'exact reason' ? senderInvalidatedError()
        : new Error('electron-bundled-avatar-sender-invalidated'));
      await vi.advanceTimersByTimeAsync(0);
      expect(conversations[0]!.cancel).toHaveBeenCalledOnce();
      expect(embodiments[0]!.cancel).toHaveBeenCalledOnce();
      if (kind === 'exact reason') {
        expect(driver.status).toBe('stopped');
        expect(driver.getLastError()).toBeNull();
        expect(consoleError).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(subscribe).toHaveBeenCalledOnce();
      } else {
        expect(driver.status).toBe('error');
        expect(consoleError).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(250);
        expect(subscribe).toHaveBeenCalledTimes(2);
        expect(driver.status).toBe('running');
      }
    } finally { await driver.stop(); consoleError.mockRestore(); vi.useRealTimers(); }
  });

  it('rejects an invalidated start without projecting driver error or readiness', async () => {
    const failure = senderInvalidatedError();
    const driver = new SdkDriver({
      conversation: { ...conversation([]), subscribe: async () => { throw failure; } },
      embodiment: embodiment(),
      agentHandle: AGENT_HANDLE, conversationAnchorId: ANCHOR, activeWorldId: '', locale: 'en-US',
    });
    const statuses: string[] = [];
    driver.onStatusChange(status => statuses.push(status));
    await expect(driver.start()).rejects.toBe(failure);
    expect(driver.status).toBe('stopped');
    expect(driver.getLastError()).toBeNull();
    expect(statuses).not.toContain('running');
    expect(statuses).not.toContain('error');
  });

  it('stops resync on the exact sender tombstone while retaining the initial unexpected EOF diagnostic', async () => {
    vi.useFakeTimers();
    const first = waitingSubscription<NimiLocalAppConversationEvent>();
    const subscribe = vi.fn().mockResolvedValueOnce(first.subscription).mockRejectedValue(senderInvalidatedError());
    const driver = new SdkDriver({
      conversation: { ...conversation([]), subscribe }, embodiment: embodiment(),
      agentHandle: AGENT_HANDLE, conversationAnchorId: ANCHOR, activeWorldId: '', locale: 'en-US',
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await driver.start(); first.end();
      await vi.advanceTimersByTimeAsync(0);
      expect(driver.status).toBe('error');
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Avatar canonical Conversation stream closed unexpectedly.'));
      await vi.advanceTimersByTimeAsync(250);
      expect(driver.status).toBe('stopped');
      expect(consoleError).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(subscribe).toHaveBeenCalledTimes(2);
    } finally { await driver.stop(); consoleError.mockRestore(); vi.useRealTimers(); }
  });

  it('stops idle pending reads by cancelling both owned streams and waits for their cleanup', async () => {
    const cleanup = deferred<void>();
    const conversationStream = waitingSubscription<NimiLocalAppConversationEvent>(cleanup.promise);
    const embodimentStream = waitingSubscription<NimiLocalAppEmbodimentEvent>(cleanup.promise);
    const driver = new SdkDriver({
      conversation: { ...conversation([]), subscribe: async () => conversationStream.subscription },
      embodiment: { ...embodiment(), subscribe: async () => embodimentStream.subscription },
      agentHandle: AGENT_HANDLE, conversationAnchorId: ANCHOR, activeWorldId: '', locale: 'en-US',
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await driver.start();
      expect(conversationStream.next).toHaveBeenCalledOnce();
      expect(embodimentStream.next).toHaveBeenCalledOnce();
      let stopped = false;
      const stopping = driver.stop().then(() => { stopped = true; });
      await Promise.resolve();
      expect(conversationStream.cancel).toHaveBeenCalledOnce();
      expect(embodimentStream.cancel).toHaveBeenCalledOnce();
      expect(stopped).toBe(false);
      cleanup.resolve(); await stopping;
      expect(driver.status).toBe('stopped');
      expect(driver.getLastError()).toBeNull();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      cleanup.resolve();
      await driver.stop();
      conversationStream.end(); embodimentStream.end();
      consoleError.mockRestore();
    }
  });

  it('stopping a pending subscribe does not wait for it and cancels its late resource without taking snapshots', async () => {
    const late = waitingSubscription<NimiLocalAppConversationEvent>();
    const pending = deferred<NimiLocalAppConversationSubscription>();
    const snapshot = vi.fn(conversation([]).snapshot);
    const subscribeEmbodiment = vi.fn(embodiment().subscribe);
    const driver = new SdkDriver({
      conversation: { ...conversation([]), subscribe: () => pending.promise, snapshot },
      embodiment: { ...embodiment(), subscribe: subscribeEmbodiment },
      agentHandle: AGENT_HANDLE, conversationAnchorId: ANCHOR, activeWorldId: '', locale: 'en-US',
    });
    const starting = driver.start().then(() => null, (error: unknown) => error);
    try {
      await driver.stop();
      expect(driver.status).toBe('stopped');
      pending.resolve(late.subscription);
      expect(await starting).toMatchObject({ name: 'AbortError' });
      expect(late.cancel).toHaveBeenCalledOnce();
      expect(late.next).not.toHaveBeenCalled();
      expect(snapshot).not.toHaveBeenCalled();
      expect(subscribeEmbodiment).not.toHaveBeenCalled();
      expect(driver.status).toBe('stopped');
    } finally { await driver.stop(); late.end(); }
  });

  it('stop waits for cleanup already started by an active stream failure', async () => {
    const cleanup = deferred<void>();
    const conversationStream = waitingSubscription<NimiLocalAppConversationEvent>(cleanup.promise);
    const embodimentStream = waitingSubscription<NimiLocalAppEmbodimentEvent>(cleanup.promise);
    const driver = new SdkDriver({
      conversation: { ...conversation([]), subscribe: async () => conversationStream.subscription },
      embodiment: { ...embodiment(), subscribe: async () => embodimentStream.subscription },
      agentHandle: AGENT_HANDLE, conversationAnchorId: ANCHOR, activeWorldId: '', locale: 'en-US',
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await driver.start();
      conversationStream.end();
      await vi.waitFor(() => expect(embodimentStream.cancel).toHaveBeenCalledOnce());
      expect(driver.status).toBe('error');
      let stopped = false;
      const stopping = driver.stop().then(() => { stopped = true; });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(stopped).toBe(false);
      cleanup.resolve(); await stopping;
      expect(driver.status).toBe('stopped');
      expect(conversationStream.cancel).toHaveBeenCalledOnce();
      expect(embodimentStream.cancel).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalledOnce();
    } finally {
      cleanup.resolve(); await driver.stop();
      conversationStream.end(); embodimentStream.end(); consoleError.mockRestore();
    }
  });

  it.each(['snapshot', 'embodiment subscribe'] as const)(
    'stopping during %s cancels owned resources and rejects late projection', async (stage) => {
      const conversationStream = waitingSubscription<NimiLocalAppConversationEvent>();
      const embodimentStream = waitingSubscription<NimiLocalAppEmbodimentEvent>();
      const pendingSnapshot = deferred<Awaited<ReturnType<NimiLocalAppConversationClient['snapshot']>>>();
      const pendingEmbodiment = deferred<NimiLocalAppEmbodimentSubscription>();
      const initialSnapshot = await conversation([]).snapshot({ agentHandle: AGENT_HANDLE, conversationAnchorId: ANCHOR });
      const subscribeEmbodiment = vi.fn(async () => stage === 'embodiment subscribe'
        ? pendingEmbodiment.promise : embodimentStream.subscription);
      const snapshot = vi.fn(async () => stage === 'snapshot' ? pendingSnapshot.promise : initialSnapshot);
      const driver = new SdkDriver({
        conversation: { ...conversation([]), subscribe: async () => conversationStream.subscription, snapshot },
        embodiment: { ...embodiment(), subscribe: subscribeEmbodiment },
        agentHandle: AGENT_HANDLE, conversationAnchorId: ANCHOR, activeWorldId: '', locale: 'en-US',
      });
      const bundles: unknown[] = [];
      driver.onBundleChange(bundle => bundles.push(bundle));
      const starting = driver.start().then(() => null, (error: unknown) => error);
      try {
        await vi.waitFor(() => expect(stage === 'snapshot' ? snapshot : subscribeEmbodiment).toHaveBeenCalledOnce());
        await driver.stop();
        expect(conversationStream.cancel).toHaveBeenCalledOnce();
        const countAtStop = bundles.length;
        pendingSnapshot.resolve(initialSnapshot); pendingEmbodiment.resolve(embodimentStream.subscription);
        expect(await starting).toMatchObject({ name: 'AbortError' });
        expect(bundles).toHaveLength(countAtStop);
        expect(driver.status).toBe('stopped');
        expect(embodimentStream.next).not.toHaveBeenCalled();
        if (stage === 'snapshot') expect(subscribeEmbodiment).not.toHaveBeenCalled();
        else expect(embodimentStream.cancel).toHaveBeenCalledOnce();
      } finally {
        pendingSnapshot.resolve(initialSnapshot); pendingEmbodiment.resolve(embodimentStream.subscription);
        await driver.stop(); conversationStream.end(); embodimentStream.end();
      }
    },
  );

  it('subscribes after the current embodiment snapshot sequence', async () => {
    let release: (() => void) | undefined;
    const closed = new Promise<void>((resolve) => { release = resolve; });
    const subscribe = vi.fn(async () => Object.assign({
      async *[Symbol.asyncIterator]() { await closed; },
    }, { async cancel() { release?.(); } }));
    const driver = new SdkDriver({
      conversation: conversation([]),
      embodiment: {
        async snapshot() {
          return {
            sequence: '257', observedAt: { seconds: '1', nanos: 0 }, provenance: 'runtime_agent_owner',
            activity: null, emotion: null, posture: null, voiceTiming: null,
          };
        },
        subscribe,
      },
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: ANCHOR,
      activeWorldId: '',
      locale: 'en-US',
    });

    await driver.start();
    expect(subscribe).toHaveBeenCalledWith({
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: ANCHOR,
      afterSequence: '257',
    });
    await driver.stop();
  });

  it('binds only agentHandle + Conversation anchor and consumes canonical events', async () => {
    const driver = new SdkDriver({
      conversation: conversation([{
        type: 'message-committed',
        conversationAnchorId: ANCHOR,
        sequence: '1',
        turnId: 'turn-1',
        message: {
          messageId: 'message-1', turnId: 'turn-1', role: 'assistant', partial: false, quote: null,
          parts: [{ kind: 'text', text: 'Hello from canonical Conversation' }],
        },
      }]),
      embodiment: embodiment(),
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: ANCHOR,
      activeWorldId: '',
      locale: 'en-US',
    });

    await driver.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(driver.getBundle()).toMatchObject({
      active_agent_handle: AGENT_HANDLE,
      status_text: 'Hello from canonical Conversation',
      custom: {
        agent_handle: AGENT_HANDLE,
        conversation_anchor_id: ANCHOR,
        latest_committed_message_text: 'Hello from canonical Conversation',
      },
    });
    expect(JSON.stringify(driver.getBundle())).not.toMatch(/local-agent:|ownerUserId|runtimeSourceRef|localAgentRef/u);
    await driver.stop();
  });

  it('projects common embodiment facts while keeping renderer mapping and audio clock App-owned', async () => {
    const base = {
      observedAt: { seconds: '2', nanos: 0 },
      provenance: 'runtime_agent_owner' as const,
    };
    const driver = new SdkDriver({
      conversation: conversation([]),
      embodiment: embodiment([
        { ...base, sequence: '2', kind: 'activity', payload: {
          name: 'happy', category: 'emotion', intensity: 'moderate', source: 'runtime', turnRef: 'turn-2',
        } },
        { ...base, sequence: '3', kind: 'emotion', payload: { name: 'happy', source: 'runtime' } },
        { ...base, sequence: '4', kind: 'posture', payload: { actionFamily: 'engage', interruptMode: 'focused' } },
        { ...base, sequence: '5', kind: 'voice-timing', payload: {
          phase: 'active', durationMillis: 1200, deadlineOffsetMillis: 80,
          turnRef: 'turn-2', correlationRef: 'voice-2',
        } },
      ]),
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: ANCHOR,
      activeWorldId: '',
      locale: 'en-US',
    });
    const events: AgentEvent[] = [];
    driver.onEvent((event) => events.push(event));

    await driver.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(driver.getBundle()).toMatchObject({
      activity: { name: 'happy', category: 'emotion', intensity: 'moderate', source: 'runtime' },
      emotion: { current: 'happy', source: 'runtime' },
      posture: { action_family: 'engage', interrupt_mode: 'focused' },
      custom: {
        embodiment_sequence: '5',
        semantic_voice_phase: 'active',
        semantic_voice_duration_millis: 1200,
        semantic_voice_deadline_offset_millis: 80,
        semantic_voice_turn_ref: 'turn-2',
        semantic_voice_correlation_ref: 'voice-2',
      },
    });
    expect(events).toContainEqual(expect.objectContaining({
      name: 'runtime.agent.presentation.activity_requested',
      detail: expect.objectContaining({
        agent_handle: AGENT_HANDLE,
        conversation_anchor_id: ANCHOR,
        activity_name: 'happy',
        source: 'runtime',
      }),
    }));
    expect(events.map((event) => event.name)).toContain('runtime.agent.state.emotion_changed');
    expect(events.map((event) => event.name)).toContain('runtime.agent.state.posture_changed');
    expect(JSON.stringify(driver.getBundle())).not.toMatch(/viseme|mouth|audioClock|provider|model/u);
    await driver.stop();
  });

  it('rejects the retired raw identity option shape at compile time', () => {
    const options: SdkDriverOptions = {
      conversation: conversation([]),
      embodiment: embodiment(),
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: ANCHOR,
      activeWorldId: '',
      locale: 'en-US',
      // @ts-expect-error raw owner identity is not part of the canonical driver contract.
      ownerUserId: 'owner-1',
    };
    expect(options.agentHandle).toBe(AGENT_HANDLE);
  });

  it('projects canonical Conversation voice bytes to Avatar playback and lipsync', async () => {
    const readArtifact = vi.fn(async () => voiceArtifact());
    const driver = new SdkDriver({
      conversation: {
        ...conversation([voiceReadyEvent()]),
        readArtifact,
      } as NimiLocalAppConversationClient,
      embodiment: embodiment(),
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: ANCHOR,
      activeWorldId: '',
      locale: 'en-US',
    });
    const events: Array<{ name: string; detail: Record<string, unknown> }> = [];
    driver.onEvent((event) => events.push(event));

    await driver.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readArtifact).toHaveBeenCalledWith({
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: ANCHOR,
      artifactId: 'voice-artifact-1',
    });
    expect(events).toContainEqual(expect.objectContaining({
      name: 'avatar.conversation.voice.audio_chunk',
      detail: expect.objectContaining({
        voice_id: 'voice-1',
        chunk_sequence: 1,
        audio_mime_type: 'audio/wav',
        chunk_bytes: Uint8Array.from([1, 2, 3]),
      }),
    }));
    await driver.stop();
  });

  it('does not emit a late voice chunk after the turn is interrupted', async () => {
    const pendingArtifact = deferred<ReturnType<typeof voiceArtifact>>();
    const readArtifact = vi.fn(() => pendingArtifact.promise);
    const driver = new SdkDriver({
      conversation: {
        ...conversation([
          voiceReadyEvent(),
          {
            type: 'turn-interrupted',
            conversationAnchorId: ANCHOR,
            sequence: '2',
            turnId: 'turn-1',
            reason: 'user_cancel',
          },
        ]),
        readArtifact,
      } as unknown as NimiLocalAppConversationClient,
      embodiment: embodiment(),
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: ANCHOR,
      activeWorldId: '',
      locale: 'en-US',
    });
    const eventNames: string[] = [];
    driver.onEvent((event) => eventNames.push(event.name));

    await driver.start();
    await vi.waitFor(() => expect(readArtifact).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(eventNames).toContain('runtime.agent.turn.interrupted'));
    pendingArtifact.resolve(voiceArtifact());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(eventNames).not.toContain('avatar.conversation.voice.audio_chunk');
    await driver.stop();
  });

  it('does not emit a late voice chunk after the driver stops', async () => {
    const pendingArtifact = deferred<ReturnType<typeof voiceArtifact>>();
    const readArtifact = vi.fn(() => pendingArtifact.promise);
    const driver = new SdkDriver({
      conversation: {
        ...conversation([voiceReadyEvent()]),
        readArtifact,
      } as unknown as NimiLocalAppConversationClient,
      embodiment: embodiment(),
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: ANCHOR,
      activeWorldId: '',
      locale: 'en-US',
    });
    const eventNames: string[] = [];
    driver.onEvent((event) => eventNames.push(event.name));

    await driver.start();
    await vi.waitFor(() => expect(readArtifact).toHaveBeenCalledOnce());
    await driver.stop();
    pendingArtifact.resolve(voiceArtifact());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(eventNames).not.toContain('avatar.conversation.voice.audio_chunk');
  });

  it('does not emit a late voice chunk from a disconnected stream after reconnect', async () => {
    const pendingArtifact = deferred<ReturnType<typeof voiceArtifact>>();
    const readArtifact = vi.fn(() => pendingArtifact.promise);
    const firstSubscription: NimiLocalAppConversationSubscription = Object.assign({
      async *[Symbol.asyncIterator]() {
        yield voiceReadyEvent();
      },
    }, {
      async cancel() {},
    });
    const steadyConversation = conversation([]);
    let subscribeCount = 0;
    const subscribe = vi.fn(async (input) => {
      subscribeCount += 1;
      if (subscribeCount === 1) return firstSubscription;
      return steadyConversation.subscribe(input);
    });
    const driver = new SdkDriver({
      conversation: {
        subscribe,
        readArtifact,
        snapshot: async () => ({
          conversationAnchorId: ANCHOR,
          throughSequence: '0',
          turns: [], messages: [], actions: [], voices: [], truncatedBefore: false,
        }),
      } as unknown as NimiLocalAppConversationClient,
      embodiment: embodiment(),
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: ANCHOR,
      activeWorldId: '',
      locale: 'en-US',
    });
    const eventNames: string[] = [];
    driver.onEvent((event) => eventNames.push(event.name));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await driver.start();
      await vi.waitFor(() => expect(readArtifact).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Avatar canonical Conversation stream closed unexpectedly.'));
      await vi.waitFor(() => expect(driver.status).toBe('running'));
      pendingArtifact.resolve(voiceArtifact());
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(eventNames).not.toContain('avatar.conversation.voice.audio_chunk');
    } finally {
      consoleError.mockRestore();
      await driver.stop();
    }
  });
});
