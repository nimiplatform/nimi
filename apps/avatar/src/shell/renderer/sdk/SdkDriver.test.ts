import { describe, expect, it, vi } from 'vitest';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationClient,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationSubscription,
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
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: ANCHOR,
      activeWorldId: '',
      locale: 'en-US',
    });

    await driver.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(driver.getBundle()).toMatchObject({
      active_user_id: AGENT_HANDLE,
      status_text: 'Hello from canonical Conversation',
      custom: {
        agent_id: AGENT_HANDLE,
        conversation_anchor_id: ANCHOR,
        latest_committed_message_text: 'Hello from canonical Conversation',
      },
    });
    expect(JSON.stringify(driver.getBundle())).not.toMatch(/local-agent:|ownerUserId|runtimeSourceRef|localAgentRef/u);
    await driver.stop();
  });

  it('rejects the retired raw identity option shape at compile time', () => {
    const options: SdkDriverOptions = {
      conversation: conversation([]),
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
      name: 'avatar.speak.native_audio_chunk',
      detail: expect.objectContaining({
        voice_stream_id: 'voice-1',
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

    expect(eventNames).not.toContain('avatar.speak.native_audio_chunk');
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

    expect(eventNames).not.toContain('avatar.speak.native_audio_chunk');
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

      expect(eventNames).not.toContain('avatar.speak.native_audio_chunk');
    } finally {
      consoleError.mockRestore();
      await driver.stop();
    }
  });
});
