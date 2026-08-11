import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentEventType,
  AgentLifecycleStatus,
  AgentPresentationEventFamily,
  CancellableStream,
  LOCAL_AGENT_REF,
  OWNER_USER_ID,
  RUNTIME_SOURCE_REF,
  RuntimeGeneratedReasonCode,
  SdkReasonCode,
  VoiceOutputMode,
  VoicePlaybackState,
  agentIdentity,
  buildNimiRuntimeAgentTurnPayload,
  createNimiError,
  createNimiHostRuntimeAgentLifecycleSurface,
  createNimiRuntimeAgentTurnsModule,
  createNimiRuntimeAgentVoiceModule,
  fromNimiRuntimeProtoStruct,
  protectedAuth,
  toNimiRuntimeProtoStruct,
  toNimiRuntimeTimestamp,
  trackedPendingStream,
  voicePlaybackRequestedAgentEvent,
  type AgentEvent,
  type AgentVoiceStreamEvent,
  type AppMessageEvent,
  type GetAgentRequest,
  type InterruptAgentVoicePlaybackRequest,
  type InterruptAgentVoicePlaybackResponse,
  type ReadArtifactBytesRequest,
  type ReadArtifactBytesResponse,
  type RuntimeTypedCallOptions,
  type SendAppMessageRequest,
  type SubscribeAgentEventsRequest,
  type SubscribeAgentVoiceStreamRequest,
  type SubscribeAppMessagesRequest,
  type TerminateAgentRequest,
} from './runtime-agent-helpers.test-helper';

test('Runtime Agent turn helper requests committed-message voice render and resolves playable Runtime projection', async () => {
  const sendCalls: SendAppMessageRequest[] = [];
  const sendOptions: RuntimeTypedCallOptions[] = [];
  const scopes: readonly string[][] = [];
  const voiceEvent = {
    messageType: 'runtime.agent.presentation.voice_playback_requested',
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: LOCAL_AGENT_REF,
      agent_id: LOCAL_AGENT_REF,
      conversation_anchor_id: 'anchor-1',
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      detail: {
        audio_artifact_id: 'artifact-audio-1',
        audio_mime_type: 'audio/wav',
        message_id: 'message-1',
        playback_state: 'requested',
        playback_target: 'desktop_manual',
        final_artifact: true,
      },
    }),
  } as AppMessageEvent;
  const appStream = new CancellableStream<AppMessageEvent>([voiceEvent]);
  const agentStream = new CancellableStream<AgentEvent>([]);
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
        },
        subscribeAgentEvents() {
          return agentStream;
        },
      },
      appMessages: {
        async sendAppMessage(request, options) {
          sendCalls.push(request);
          sendOptions.push(options ?? {});
          return { messageId: 'request-message-1', accepted: true, reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED };
        },
        subscribeAppMessages() {
          return appStream;
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (nextScopes, operation) => {
      scopes.push(nextScopes);
      return operation({ metadata: { scoped: nextScopes.join(',') } });
    },
  });

  const result = await module.renderVoice({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    messageId: 'message-1',
    text: 'Committed answer',
    idempotencyKey: 'voice-render-test-1',
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.status === 'ready' ? result.audioArtifactId : '', 'artifact-audio-1');
  assert.deepEqual(scopes, [
    ['runtime.agent.turn.read'],
    ['runtime.agent.read'],
    ['runtime.agent.turn.write'],
  ]);
  assert.equal(sendCalls[0]?.messageType, 'runtime.agent.turn.voice_render');
  assert.equal(sendCalls[0]?.subjectUserId, 'user-1');
  assert.deepEqual(fromNimiRuntimeProtoStruct(sendCalls[0]?.payload), {
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    message_id: 'message-1',
    text: 'Committed answer',
    playback_target: 'desktop_manual',
  });
  assert.equal(sendOptions[0]?.metadata?.idempotencyKey, 'voice-render-test-1');
  assert.equal(sendOptions[0]?.metadata?.['x-nimi-idempotency-key'], 'voice-render-test-1');
  assert.equal(sendOptions[0]?.metadata?.scoped, 'runtime.agent.turn.write');
  assert.equal(appStream.returnCount, 1);
  assert.equal(agentStream.returnCount, 1);
});

test('Runtime Agent turn helper resolves voice render projection from Agent presentation events when app stream has no live tail', async () => {
  const appStream = new CancellableStream<AppMessageEvent>([]);
  const agentStream = new CancellableStream<AgentEvent>([
    voicePlaybackRequestedAgentEvent({
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-1',
      streamId: 'stream-1',
      messageId: 'message-1',
      audioArtifactId: 'artifact-agent-audio-1',
      audioMimeType: 'audio/wav',
      playbackTarget: 'desktop_manual',
    }),
  ]);
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
        },
        subscribeAgentEvents() {
          return agentStream;
        },
      },
      appMessages: {
        async sendAppMessage() {
          return { messageId: 'request-message-1', accepted: true, reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED };
        },
        subscribeAppMessages() {
          return appStream;
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (_nextScopes, operation) => operation({}),
  });

  const result = await module.renderVoice({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    messageId: 'message-1',
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.status === 'ready' ? result.audioArtifactId : '', 'artifact-agent-audio-1');
  assert.equal(appStream.returnCount, 1);
  assert.equal(agentStream.returnCount, 1);
});

test('Runtime Agent turn helper reports text_only when Runtime emits no playable voice projection', async () => {
  const appStream = new CancellableStream<AppMessageEvent>([]);
  const agentStream = new CancellableStream<AgentEvent>([]);
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
        },
        subscribeAgentEvents() {
          return agentStream;
        },
      },
      appMessages: {
        async sendAppMessage() {
          return { messageId: 'request-message-1', accepted: true, reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED };
        },
        subscribeAppMessages() {
          return appStream;
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (_nextScopes, operation) => operation({}),
  });

  let observedTimeoutMs: number | undefined;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]) => {
    observedTimeoutMs = timeout;
    handler(...args);
    return 0 as unknown as ReturnType<typeof globalThis.setTimeout>;
  }) as typeof globalThis.setTimeout;
  let result;
  try {
    result = await module.renderVoice({
      ownerUserId: OWNER_USER_ID,
      runtimeSourceRef: RUNTIME_SOURCE_REF,
      localAgentRef: LOCAL_AGENT_REF,
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-1',
      messageId: 'message-1',
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.deepEqual(result, {
    status: 'text_only',
    reason: 'voice_projection_unavailable',
  });
  assert.equal(observedTimeoutMs, 15 * 60 * 1000);
  assert.equal(appStream.returnCount, 1);
  assert.equal(agentStream.returnCount, 1);
});

test('Runtime Agent voice helper consumes typed stream and replays only audio artifacts', async () => {
  const scopes: readonly string[][] = [];
  const streamRequests: SubscribeAgentVoiceStreamRequest[] = [];
  const interruptRequests: InterruptAgentVoicePlaybackRequest[] = [];
  const artifactReads: ReadArtifactBytesRequest[] = [];
  const voiceEvents: AgentVoiceStreamEvent[] = [{
    voiceStreamId: 'voice-stream-1',
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    streamId: 'stream-1',
    messageId: 'message-1',
    chunkSequence: '1',
    chunk: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/wav',
    voiceOutputMode: 1,
    playbackTarget: 'avatar_autoplay',
    terminal: false,
    voicePlaybackState: 1,
    terminalReason: '',
    replayTruncated: false,
  }];
  const module = createNimiRuntimeAgentVoiceModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      agents: {
        async *subscribeAgentVoiceStream(request) {
          streamRequests.push(request);
          yield* voiceEvents;
        },
        async interruptAgentVoicePlayback(request): Promise<InterruptAgentVoicePlaybackResponse> {
          interruptRequests.push(request);
          return {
            voiceStreamId: request.voiceStreamId,
            voiceOutputMode: 1,
            voicePlaybackState: 3,
            terminalReason: request.reason || 'runtime_voice_interrupt_requested',
          };
        },
      },
      artifacts: {
        async readArtifactBytes(request): Promise<ReadArtifactBytesResponse> {
          artifactReads.push(request);
          return {
            bytes: new Uint8Array([9, 8, 7]),
            mimeType: request.artifactId === 'artifact-audio-1' ? 'audio/wav' : 'text/plain',
            sizeBytes: '3',
            mimeInferred: false,
          };
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (nextScopes, operation) => {
      scopes.push(nextScopes);
      return operation({ metadata: { scoped: nextScopes.join(',') } });
    },
  });

  const stream = await module.subscribeStream({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    voiceStreamId: 'voice-stream-1',
  });
  const received: AgentVoiceStreamEvent[] = [];
  for await (const event of stream) {
    received.push(event);
  }
  assert.deepEqual([...received[0]?.chunk ?? []], [1, 2, 3]);
  assert.equal(streamRequests[0]?.voiceStreamId, 'voice-stream-1');
  assert.equal(streamRequests[0]?.agentId, LOCAL_AGENT_REF);
  assert.equal(streamRequests[0]?.context?.localAgentRef, LOCAL_AGENT_REF);
  assert.equal('scopedBinding' in (streamRequests[0]?.context ?? {}), false);
  assert.deepEqual(scopes[0], ['runtime.agent.turn.read']);

  const replay = await module.replayFinalArtifact({ artifactId: 'artifact-audio-1' });
  assert.deepEqual([...replay.bytes], [9, 8, 7]);
  assert.equal(artifactReads[0]?.artifactId, 'artifact-audio-1');
  await assert.rejects(
    () => module.replayFinalArtifact({ artifactId: 'artifact-text-1' }),
    (error: unknown) => {
      const nimiError = error as {
        readonly reasonCode?: string;
        readonly actionHint?: string;
      };
      assert.equal(nimiError.reasonCode, SdkReasonCode.AI_INPUT_INVALID);
      assert.equal(nimiError.actionHint, 'validate_runtime_voice_final_artifact_mime');
      return true;
    },
  );
  const interrupt = await module.interruptPlayback({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    voiceStreamId: 'voice-stream-1',
    reason: 'avatar_user_interrupt',
  });
  assert.equal(interrupt.voicePlaybackState, 3);
  assert.equal(interrupt.terminalReason, 'avatar_user_interrupt');
  assert.equal(interruptRequests[0]?.voiceStreamId, 'voice-stream-1');
  assert.equal(interruptRequests[0]?.conversationAnchorId, 'anchor-1');
  assert.equal(interruptRequests[0]?.turnId, 'turn-1');
  assert.equal(interruptRequests[0]?.context?.localAgentRef, LOCAL_AGENT_REF);
  assert.equal('scopedBinding' in (interruptRequests[0]?.context ?? {}), false);
  assert.deepEqual(scopes[1], ['runtime.agent.turn.write']);
});

test('Runtime Agent voice helper uses the host operation context for each voice operation', async () => {
  const streamOptions: RuntimeTypedCallOptions[] = [];
  const interruptOptions: RuntimeTypedCallOptions[] = [];
  const authCalls: string[] = [];
  const module = createNimiRuntimeAgentVoiceModule({
    runtime: {
      appId: 'desktop',
      auth: {
        async registerApp() {
          authCalls.push('register');
          return { accepted: true };
        },
      },
      agents: {
        async *subscribeAgentVoiceStream(_request, options) {
          streamOptions.push(options ?? {});
          yield {
            voiceStreamId: 'voice-stream-1',
            conversationAnchorId: 'anchor-1',
            turnId: 'turn-1',
            streamId: 'stream-1',
            messageId: 'message-1',
            chunkSequence: '1',
            chunk: new Uint8Array([1]),
            mimeType: 'audio/wav',
            voiceOutputMode: 1,
            playbackTarget: 'avatar_autoplay',
            terminal: false,
            voicePlaybackState: 1,
            terminalReason: '',
            replayTruncated: false,
          };
        },
        async interruptAgentVoicePlayback(request, options) {
          interruptOptions.push(options ?? {});
          return {
            voiceStreamId: request.voiceStreamId,
            voiceOutputMode: 1,
            voicePlaybackState: 3,
            terminalReason: request.reason,
          };
        },
      },
      artifacts: {
        async readArtifactBytes() {
          throw new Error('not expected');
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (_nextScopes, operation) => operation({}),
  });

  const stream = await module.subscribeStream({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    voiceStreamId: 'voice-stream-1',
  });
  for await (const _event of stream) {
    break;
  }
  await module.interruptPlayback({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    voiceStreamId: 'voice-stream-1',
    reason: 'user_cancelled',
  });

  assert.deepEqual(authCalls, []);
  assert.deepEqual(streamOptions, [{ metadata: {} }]);
  assert.equal(
    interruptOptions[0]?.metadata?.idempotencyKey,
    'runtime-agent-voice-interrupt:user-1:agent-1:local-agent:test-user-1-agent-1:anchor-1:turn-1:voice-stream-1:user_cancelled',
  );
  assert.equal(
    interruptOptions[0]?.metadata?.['x-nimi-idempotency-key'],
    'runtime-agent-voice-interrupt:user-1:agent-1:local-agent:test-user-1-agent-1:anchor-1:turn-1:voice-stream-1:user_cancelled',
  );
  assert.equal(interruptOptions[0]?.metadata?.['x-nimi-access-token-id'], undefined);
});

test('Runtime Agent voice helper forwards only host operation call options without changing request identity', async () => {
  const streamOptions: RuntimeTypedCallOptions[] = [];
  const streamRequests: unknown[] = [];
  const authCalls: string[] = [];
  const module = createNimiRuntimeAgentVoiceModule({
    runtime: {
      appId: 'avatar',
      auth: {
        async registerApp() {
          authCalls.push('register');
          throw new Error('Runtime auth fallback must not run for Runtime auth bindings');
        },
      },
      agents: {
        async *subscribeAgentVoiceStream(request, options) {
          streamRequests.push(request);
          streamOptions.push(options ?? {});
          yield {
            voiceStreamId: 'voice-stream-1',
            conversationAnchorId: 'anchor-1',
            turnId: 'turn-1',
            streamId: 'stream-1',
            messageId: 'message-1',
            chunkSequence: '1',
            chunk: new Uint8Array([1]),
            mimeType: 'audio/wav',
            voiceOutputMode: 1,
            playbackTarget: 'avatar_autoplay',
            terminal: false,
            voicePlaybackState: 1,
            terminalReason: '',
            replayTruncated: false,
          };
        },
        async interruptAgentVoicePlayback() {
          throw new Error('not expected');
        },
      },
      artifacts: {
        async readArtifactBytes() {
          throw new Error('not expected');
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (_nextScopes, operation) => operation({
      metadata: { 'x-nimi-host-operation-context': 'current' },
    }),
  });

  const stream = await module.subscribeStream({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    voiceStreamId: 'voice-stream-1',
  });
  for await (const _event of stream) {
    break;
  }

  assert.deepEqual(authCalls, []);
  assert.equal(streamOptions[0]?.metadata?.['x-nimi-host-operation-context'], 'current');
  assert.equal(streamOptions[0]?.metadata?.['x-nimi-access-token-id'], undefined);
  const context = (streamRequests[0] as {
    readonly context?: Record<string, unknown>;
  } | undefined)?.context;
  assert.equal(context?.localAgentRef, LOCAL_AGENT_REF);
  assert.equal('scopedBinding' in (context ?? {}), false);
});

test('Runtime Agent voice helper accepts an empty host operation context without manufacturing metadata', async () => {
  const streamOptions: RuntimeTypedCallOptions[] = [];
  const authCalls: string[] = [];
  const module = createNimiRuntimeAgentVoiceModule({
    runtime: {
      appId: 'zhiyu',
      auth: {
        async registerApp() {
          authCalls.push('register');
          throw new Error('Runtime auth fallback must not run for the protected carrier');
        },
      },
      agents: {
        async *subscribeAgentVoiceStream(_request, options) {
          streamOptions.push(options ?? {});
          yield {
            voiceStreamId: 'voice-stream-1',
            conversationAnchorId: 'anchor-1',
            turnId: 'turn-1',
            streamId: 'stream-1',
            messageId: 'message-1',
            chunkSequence: '1',
            chunk: new Uint8Array([1]),
            mimeType: 'audio/wav',
            voiceOutputMode: 1,
            playbackTarget: 'avatar_autoplay',
            terminal: false,
            voicePlaybackState: 1,
            terminalReason: '',
            replayTruncated: false,
          };
        },
        async interruptAgentVoicePlayback() {
          throw new Error('not expected');
        },
      },
      artifacts: {
        async readArtifactBytes() {
          throw new Error('not expected');
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (_nextScopes, operation) => operation({}),
  });

  const stream = await module.subscribeStream({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    voiceStreamId: 'voice-stream-1',
  });
  for await (const _event of stream) {
    break;
  }

  assert.deepEqual(authCalls, []);
  assert.deepEqual(streamOptions, [{ metadata: {} }]);
});
