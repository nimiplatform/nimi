import { describe, expect, it, vi } from 'vitest';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationClient,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationSubscription,
  NimiLocalAppEmbodimentClient,
  NimiLocalAppEmbodimentEvent,
} from '@nimiplatform/sdk/app';
import { SdkDriver, type SdkDriverOptions } from './SdkDriver.js';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle;
const ANCHOR = 'anchor-1';

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
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
  let release: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => { release = resolve; });
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
      return Object.assign({
        async *[Symbol.asyncIterator]() {
          for (const event of events) yield event;
          await closed;
        },
      }, { async cancel() { release?.(); } });
    },
  };
}

describe('SdkDriver canonical App Product Plane', () => {
  it('binds only agentHandle + Conversation anchor and consumes canonical events', async () => {
    const driver = new SdkDriver({
      conversation: conversation([{
        type: 'message-committed',
        conversationAnchorId: ANCHOR,
        sequence: '1',
        turnId: 'turn-1',
        message: {
          messageId: 'message-1', turnId: 'turn-1', role: 'assistant',
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
    const events: string[] = [];
    driver.onEvent((event) => events.push(event.name));

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
    expect(events).toContain('runtime.agent.presentation.activity_requested');
    expect(events).toContain('runtime.agent.state.emotion_changed');
    expect(events).toContain('runtime.agent.state.posture_changed');
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
      pendingArtifact.resolve(voiceArtifact());
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(eventNames).not.toContain('avatar.conversation.voice.audio_chunk');
    } finally {
      consoleError.mockRestore();
      await driver.stop();
    }
  });
});
