import { describe, expect, it, vi } from 'vitest';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppClient,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationSnapshot,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  createAppConversationEntrySession,
  type AppConversationHostPort,
} from '../src/headless/app-conversation-entry-session.js';

const HANDLE_A = `agent_ref_${'A'.repeat(43)}` as NimiLocalAppAgentHandle;
const HANDLE_B = `agent_ref_${'B'.repeat(43)}` as NimiLocalAppAgentHandle;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class EventQueue implements AsyncIterable<NimiLocalAppConversationEvent> {
  private values: NimiLocalAppConversationEvent[] = [];
  private waiters: Array<{
    resolve: (result: IteratorResult<NimiLocalAppConversationEvent>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private closed = false;
  private failure: unknown = null;

  push(event: NimiLocalAppConversationEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value: event });
    else this.values.push(event);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ done: true, value: undefined });
  }

  fail(error: unknown): void {
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<NimiLocalAppConversationEvent> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value) return { done: false, value };
        if (this.failure) throw this.failure;
        if (this.closed) return { done: true, value: undefined };
        return new Promise<IteratorResult<NimiLocalAppConversationEvent>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
    };
  }
}

function snapshot(input: {
  throughSequence?: string;
  messages?: NimiLocalAppConversationSnapshot['messages'];
} = {}): NimiLocalAppConversationSnapshot {
  return {
    conversationAnchorId: 'anchor-a',
    throughSequence: input.throughSequence ?? '2',
    turns: [{
      turnId: 'turn-1',
      status: 'completed',
      phase: 'started',
      terminalReason: 'stop',
      reasonCode: null,
      message: null,
    }],
    messages: input.messages ?? [{
      messageId: 'message-1',
      turnId: 'turn-1',
      role: 'assistant',
      parts: [{ kind: 'text', text: 'Committed snapshot text' }],
    }],
    actions: [],
    voices: [],
    truncatedBefore: false,
  };
}

function harness(input: {
  snapshot?: () => Promise<NimiLocalAppConversationSnapshot>;
  renderVoice?: NimiLocalAppClient['conversation']['renderVoice'];
  replacementQueue?: EventQueue;
} = {}) {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const queue = new EventQueue();
  let subscriptionCount = 0;
  const hostPort: AppConversationHostPort = {
    playback: {
      play: vi.fn(async (playInput) => {
        calls.push({ method: 'play', input: playInput });
        return { status: 'playing' as const };
      }),
      stop: vi.fn(async () => { calls.push({ method: 'stop' }); }),
    },
    preview: {
      materialize: vi.fn(async (previewInput) => {
        calls.push({ method: 'materializePreview', input: previewInput });
        return { status: 'ready' as const, previewHandle: 'preview-1', mediaUrl: 'blob:host-preview-1' };
      }),
      release: vi.fn(async (releaseInput) => { calls.push({ method: 'releasePreview', input: releaseInput }); }),
    },
    attachments: {
      pickImage: vi.fn(async () => ({
        status: 'unavailable' as const,
        reasonCode: 'PICKER_UNAVAILABLE',
        message: null,
      })),
    },
    voiceInput: {
      record: vi.fn(async () => ({
        status: 'unavailable' as const,
        reasonCode: 'RECORDER_UNAVAILABLE',
        message: null,
      })),
      cancel: vi.fn(async () => {}),
    },
  };
  const client = {
    agents: {
      listReferences: vi.fn(async () => {
        calls.push({ method: 'listReferences' });
        return [
          { agentHandle: HANDLE_A, displayName: 'Same name', avatarUrl: null },
          { agentHandle: HANDLE_B, displayName: 'Same name', avatarUrl: null },
        ];
      }),
    },
    conversation: {
      open: vi.fn(async (openInput) => {
        calls.push({ method: 'open', input: openInput });
        return { conversationAnchorId: 'anchor-a', activeTurnId: null };
      }),
      subscribe: vi.fn(async (subscribeInput) => {
        calls.push({ method: 'subscribe', input: subscribeInput });
        const subscribedQueue = subscriptionCount > 0 && input.replacementQueue
          ? input.replacementQueue
          : queue;
        subscriptionCount += 1;
        return {
          [Symbol.asyncIterator]: () => subscribedQueue[Symbol.asyncIterator](),
          cancel: vi.fn(async () => {
            calls.push({ method: 'cancel' });
            subscribedQueue.close();
          }),
        };
      }),
      snapshot: vi.fn(async (snapshotInput) => {
        calls.push({ method: 'snapshot', input: snapshotInput });
        return input.snapshot ? input.snapshot() : snapshot();
      }),
      send: vi.fn(async (sendInput) => {
        calls.push({ method: 'send', input: sendInput });
        return { turnId: 'turn-2' };
      }),
      uploadAttachment: vi.fn(async (uploadInput) => {
        calls.push({ method: 'uploadAttachment', input: uploadInput });
        return { artifactId: 'artifact-upload-1', expiresAt: '2026-08-30T00:00:00.000Z' };
      }),
      transcribeVoice: vi.fn(async (transcribeInput) => {
        calls.push({ method: 'transcribeVoice', input: transcribeInput });
        return { text: 'Transcribed text' };
      }),
      interruptTurn: vi.fn(async (interruptInput) => {
        calls.push({ method: 'interrupt', input: interruptInput });
        return { turnId: 'turn-2' };
      }),
      renderVoice: input.renderVoice ?? vi.fn(async (renderInput) => {
        calls.push({ method: 'renderVoice', input: renderInput });
        return {
          status: 'ready' as const,
          voiceId: 'voice-1',
          turnId: 'turn-1',
          messageId: 'message-1',
          artifactId: 'artifact-audio-1',
        };
      }),
      readArtifact: vi.fn(async (readInput) => {
        calls.push({ method: 'readArtifact', input: readInput });
        if (readInput.artifactId === 'artifact-image-1') {
          return {
            artifactId: 'artifact-image-1',
            mimeType: 'image/png',
            byteLength: 3,
            bytes: Uint8Array.from([4, 5, 6]),
          };
        }
        return {
          artifactId: 'artifact-audio-1',
          mimeType: 'audio/ogg',
          byteLength: 3,
          bytes: Uint8Array.from([1, 2, 3]),
        };
      }),
    },
  } as unknown as NimiLocalAppClient;
  return {
    calls,
    client,
    hostPort,
    queue,
    session: createAppConversationEntrySession({ client, hostPort }),
  };
}

async function readySession(testHarness: ReturnType<typeof harness>): Promise<void> {
  await testHarness.session.loadReferences();
  await testHarness.session.selectReference(HANDLE_A);
  expect(testHarness.session.getState().status).toBe('ready');
}

describe('App Conversation entry session', () => {
  it('requires an explicit handle selection and fences buffered events against a subscribe-before-snapshot high-water', async () => {
    const snapshotGate = deferred<NimiLocalAppConversationSnapshot>();
    const testHarness = harness({ snapshot: () => snapshotGate.promise });
    await testHarness.session.loadReferences();
    expect(testHarness.session.getState().status).toBe('select-reference');
    expect(testHarness.calls.some((call) => call.method === 'open')).toBe(false);

    const selecting = testHarness.session.selectReference(HANDLE_A);
    await vi.waitFor(() => {
      expect(testHarness.calls.map((call) => call.method)).toContain('snapshot');
    });
    expect(testHarness.calls.map((call) => call.method).filter((method) => (
      method === 'open' || method === 'subscribe' || method === 'snapshot'
    ))).toEqual(['open', 'subscribe', 'snapshot']);

    testHarness.queue.push({
      type: 'message-committed',
      conversationAnchorId: 'anchor-a',
      sequence: '2',
      turnId: 'turn-1',
      message: {
        messageId: 'stale-message',
        turnId: 'turn-1',
        role: 'assistant',
        parts: [{ kind: 'text', text: 'Must be fenced' }],
      },
    });
    testHarness.queue.push({
      type: 'message-committed',
      conversationAnchorId: 'anchor-a',
      sequence: '3',
      turnId: 'turn-1',
      message: {
        messageId: 'message-image',
        turnId: 'turn-1',
        role: 'assistant',
        parts: [{ kind: 'text', text: 'Visible image caption' }, {
          kind: 'artifact-ref',
          artifactId: 'artifact-image-1',
          mediaKind: 'image',
          mimeType: 'image/png',
          displayName: 'Result',
        }],
      },
    });
    snapshotGate.resolve(snapshot());
    await selecting;

    const state = testHarness.session.getState();
    expect(state.status).toBe('ready');
    expect(state.throughSequence).toBe('3');
    expect(state.messages.map((message) => message.id)).toEqual(['message-1', 'message-image']);
    expect(state.messages.some((message) => message.id === 'stale-message')).toBe(false);
    expect(state.messages.every((message) => message.createdAt === '')).toBe(true);
    expect(state.messages[1]).toMatchObject({
      kind: 'image',
      text: 'Visible image caption',
      metadata: {
        conversationAnchorId: 'anchor-a',
        turnId: 'turn-1',
        artifactId: 'artifact-image-1',
        mimeType: 'image/png',
        mediaUrl: 'blob:host-preview-1',
        caption: 'Visible image caption',
      },
    });
    expect(testHarness.calls.map((call) => call.method).filter((method) => (
      method === 'readArtifact' || method === 'materializePreview'
    ))).toEqual(['readArtifact', 'materializePreview']);
    expect(JSON.stringify(state)).not.toMatch(/ownerUserId|localAgentRef|runtimeSourceRef|createdAtMs/u);
  });

  it('sends and interrupts through the exact session without optimistic message truth', async () => {
    const testHarness = harness();
    await readySession(testHarness);
    const before = testHarness.session.getState().messages;
    await testHarness.session.send({
      requestId: 'request-send-1',
      parts: [{ kind: 'text', text: 'Hello' }],
    });
    await testHarness.session.interrupt();
    expect(testHarness.session.getState().messages).toEqual(before);
    expect(testHarness.calls).toContainEqual({
      method: 'send',
      input: {
        agentHandle: HANDLE_A,
        conversationAnchorId: 'anchor-a',
        requestId: 'request-send-1',
        parts: [{ kind: 'text', text: 'Hello' }],
      },
    });
    expect(testHarness.calls).toContainEqual({
      method: 'interrupt',
      input: { agentHandle: HANDLE_A, conversationAnchorId: 'anchor-a' },
    });
  });

  it('renders and reads canonical voice before handing bounded audio bytes to Host playback mechanics', async () => {
    const testHarness = harness();
    await readySession(testHarness);
    await expect(testHarness.session.playVoice({
      messageId: 'message-1',
      requestId: 'request-voice-1',
    })).resolves.toEqual({ status: 'played' });
    expect(testHarness.calls.map((call) => call.method).filter((method) => (
      method === 'renderVoice' || method === 'readArtifact' || method === 'play'
    ))).toEqual(['renderVoice', 'readArtifact', 'play']);
    const hostInput = testHarness.calls.find((call) => call.method === 'play')?.input;
    expect(hostInput).toMatchObject({
      conversationAnchorId: 'anchor-a',
      messageId: 'message-1',
      mimeType: 'audio/ogg',
    });
    expect(hostInput).not.toHaveProperty('agentHandle');
    expect(hostInput).not.toHaveProperty('voiceId');
    expect(hostInput).not.toHaveProperty('artifactId');
  });

  it('accepts a strictly increasing public sequence gap without clearing committed truth', async () => {
    const testHarness = harness();
    await readySession(testHarness);
    testHarness.queue.push({
      type: 'turn-started',
      conversationAnchorId: 'anchor-a',
      sequence: '4',
      turnId: 'turn-gap',
    });
    await vi.waitFor(() => expect(testHarness.session.getState().throughSequence).toBe('4'));
    expect(testHarness.session.getState()).toMatchObject({
      status: 'ready',
      conversationAnchorId: 'anchor-a',
      throughSequence: '4',
      activeTurnId: 'turn-gap',
    });
    expect(testHarness.session.getState().messages).toHaveLength(1);
  });

  it('replaces a retryable overflow subscription before rehydrating a fresh snapshot', async () => {
    const replacementQueue = new EventQueue();
    let snapshotRead = 0;
    const testHarness = harness({
      replacementQueue,
      snapshot: async () => {
        snapshotRead += 1;
        return snapshot({
          throughSequence: snapshotRead === 1 ? '2' : '5',
          messages: snapshotRead === 1 ? undefined : [{
            messageId: 'message-rehydrated',
            turnId: 'turn-5',
            role: 'assistant',
            parts: [{ kind: 'text', text: 'Fresh committed truth' }],
          }],
        });
      },
    });
    await readySession(testHarness);

    testHarness.queue.fail(Object.assign(new Error('conversation buffer exhausted'), {
      code: 'resource-exhausted',
      reasonCode: 'renderer-local-app-conversation-buffer-exhausted',
      details: { retryable: true },
    }));

    await vi.waitFor(() => {
      expect(testHarness.calls.filter((call) => call.method === 'subscribe')).toHaveLength(2);
      expect(testHarness.calls.filter((call) => call.method === 'snapshot')).toHaveLength(2);
      expect(testHarness.session.getState().throughSequence).toBe('5');
    });
    expect(testHarness.session.getState()).toMatchObject({
      status: 'ready',
      conversationAnchorId: 'anchor-a',
      messages: [{ id: 'message-rehydrated', text: 'Fresh committed truth' }],
    });
  });

  it('fences late voice results after the selected session is cleared', async () => {
    const renderGate = deferred<Awaited<ReturnType<NimiLocalAppClient['conversation']['renderVoice']>>>();
    const testHarness = harness({
      renderVoice: vi.fn(async (renderInput) => {
        testHarness.calls.push({ method: 'renderVoice', input: renderInput });
        return renderGate.promise;
      }),
    });
    await readySession(testHarness);
    const playing = testHarness.session.playVoice({
      messageId: 'message-1',
      requestId: 'request-voice-late',
    });
    await vi.waitFor(() => expect(testHarness.calls.some((call) => call.method === 'renderVoice')).toBe(true));
    await testHarness.session.clearSelection();
    renderGate.resolve({
      status: 'ready',
      voiceId: 'voice-late',
      turnId: 'turn-1',
      messageId: 'message-1',
      artifactId: 'artifact-late',
    });
    await expect(playing).rejects.toThrow('session changed');
    expect(testHarness.calls.some((call) => call.method === 'readArtifact')).toBe(false);
    expect(testHarness.calls.some((call) => call.method === 'play')).toBe(false);
    expect(testHarness.session.getState()).toMatchObject({
      status: 'select-reference',
      selectedReference: null,
      messages: [],
      actionError: null,
    });
  });

  it('rejects a stale handle without opening a Conversation', async () => {
    const testHarness = harness();
    await testHarness.session.loadReferences();
    const stale = `agent_ref_${'Z'.repeat(43)}` as NimiLocalAppAgentHandle;
    await testHarness.session.selectReference(stale);
    expect(testHarness.session.getState()).toMatchObject({
      status: 'stale',
      selectedReference: null,
      conversationAnchorId: null,
      messages: [],
    });
    expect(testHarness.calls.some((call) => call.method === 'open')).toBe(false);
  });

  it('fails closed without selecting or opening when current references are unavailable', async () => {
    const testHarness = harness();
    vi.mocked(testHarness.client.agents.listReferences).mockRejectedValueOnce(new Error('Runtime unavailable'));
    await testHarness.session.loadReferences();
    expect(testHarness.session.getState()).toMatchObject({
      status: 'failed',
      references: [],
      selectedReference: null,
      conversationAnchorId: null,
      messages: [],
      error: 'Runtime unavailable',
    });
    expect(testHarness.calls.some((call) => call.method === 'open')).toBe(false);
  });

  it('preserves typed voice unavailability without reading or playing an artifact', async () => {
    const renderVoice = vi.fn(async () => ({
      status: 'unavailable' as const,
      voiceId: 'voice-unavailable',
      turnId: 'turn-1',
      messageId: 'message-1',
      reasonCode: 'VOICE_NOT_CONFIGURED',
      message: 'Voice is not configured.',
    }));
    const testHarness = harness({ renderVoice });
    await readySession(testHarness);
    await expect(testHarness.session.playVoice({
      messageId: 'message-1',
      requestId: 'request-voice-unavailable',
    })).resolves.toEqual({
      status: 'unavailable',
      reasonCode: 'VOICE_NOT_CONFIGURED',
      message: 'Voice is not configured.',
    });
    expect(renderVoice).toHaveBeenCalledTimes(1);
    expect(testHarness.calls.some((call) => call.method === 'readArtifact')).toBe(false);
    expect(testHarness.calls.some((call) => call.method === 'play')).toBe(false);
  });

  it('uploads a Host-picked image and sends only its canonical artifact reference without optimistic truth', async () => {
    const testHarness = harness();
    vi.mocked(testHarness.hostPort.attachments.pickImage).mockResolvedValueOnce({
      status: 'selected',
      mimeType: 'image/png',
      displayName: 'picked.png',
      bytes: Uint8Array.from([7, 8, 9]),
    });
    await readySession(testHarness);
    await expect(testHarness.session.pickAttachment()).resolves.toMatchObject({
      artifactId: 'artifact-upload-1',
      mimeType: 'image/png',
      displayName: 'picked.png',
    });
    expect(testHarness.session.getState().pendingAttachment?.artifactId).toBe('artifact-upload-1');
    const before = testHarness.session.getState().messages;
    await testHarness.session.send({
      requestId: 'request-with-image',
      parts: [
        { kind: 'text', text: 'Caption' },
        { kind: 'artifact-ref', artifactId: 'artifact-upload-1' },
      ],
    });
    expect(testHarness.session.getState().pendingAttachment).toBeNull();
    expect(testHarness.session.getState().messages).toEqual(before);
    expect(testHarness.calls).toContainEqual({
      method: 'uploadAttachment',
      input: {
        agentHandle: HANDLE_A,
        conversationAnchorId: 'anchor-a',
        mimeType: 'image/png',
        displayName: 'picked.png',
        bytes: Uint8Array.from([7, 8, 9]),
      },
    });
    expect(testHarness.calls).toContainEqual({
      method: 'send',
      input: {
        agentHandle: HANDLE_A,
        conversationAnchorId: 'anchor-a',
        requestId: 'request-with-image',
        parts: [
          { kind: 'text', text: 'Caption' },
          { kind: 'artifact-ref', artifactId: 'artifact-upload-1' },
        ],
      },
    });
  });

  it('transcribes Host-recorded audio and fences a late transcription after session invalidation', async () => {
    const transcriptionGate = deferred<{ text: string }>();
    const testHarness = harness();
    vi.mocked(testHarness.hostPort.voiceInput.record).mockResolvedValueOnce({
      status: 'recorded',
      mimeType: 'audio/webm',
      bytes: Uint8Array.from([3, 2, 1]),
    });
    vi.mocked(testHarness.client.conversation.transcribeVoice).mockImplementationOnce(async (input) => {
      testHarness.calls.push({ method: 'transcribeVoice', input });
      return transcriptionGate.promise;
    });
    await readySession(testHarness);
    const transcribing = testHarness.session.recordAndTranscribe({ requestId: 'request-transcribe-late' });
    await vi.waitFor(() => expect(testHarness.calls.some((call) => call.method === 'transcribeVoice')).toBe(true));
    await testHarness.session.clearSelection();
    transcriptionGate.resolve({ text: 'Late transcript' });
    await expect(transcribing).rejects.toThrow('session changed');
    expect(testHarness.session.getState()).toMatchObject({
      status: 'select-reference',
      actionError: null,
      messages: [],
    });
  });

  it('releases a late Host preview and never publishes it into a replaced session', async () => {
    const previewGate = deferred<{ status: 'ready'; previewHandle: string; mediaUrl: string }>();
    const testHarness = harness({
      snapshot: async () => snapshot({
        throughSequence: '1',
        messages: [{
          messageId: 'message-image',
          turnId: 'turn-1',
          role: 'assistant',
          parts: [{
            kind: 'artifact-ref',
            artifactId: 'artifact-image-1',
            mediaKind: 'image',
            mimeType: 'image/png',
            displayName: null,
          }],
        }],
      }),
    });
    vi.mocked(testHarness.hostPort.preview.materialize).mockImplementationOnce(async () => previewGate.promise);
    await testHarness.session.loadReferences();
    const selecting = testHarness.session.selectReference(HANDLE_A);
    await vi.waitFor(() => expect(testHarness.hostPort.preview.materialize).toHaveBeenCalledTimes(1));
    await testHarness.session.clearSelection();
    previewGate.resolve({ status: 'ready', previewHandle: 'preview-late', mediaUrl: 'blob:host-preview-late' });
    await selecting;
    await vi.waitFor(() => expect(testHarness.hostPort.preview.release).toHaveBeenCalledWith({
      previewHandle: 'preview-late',
    }));
    expect(testHarness.session.getState()).toMatchObject({
      status: 'select-reference',
      messages: [],
    });
  });

  it('does not let Host playback stop failure block reference reload or a new product session', async () => {
    const testHarness = harness();
    await readySession(testHarness);
    vi.mocked(testHarness.hostPort.playback.stop).mockRejectedValueOnce(new Error('Host stop failed'));
    await testHarness.session.loadReferences();
    expect(testHarness.session.getState()).toMatchObject({
      status: 'select-reference',
      selectedReference: null,
      conversationAnchorId: null,
    });
    expect(testHarness.client.agents.listReferences).toHaveBeenCalledTimes(2);
  });
});
