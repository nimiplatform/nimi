import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AgentEvent,
  AgentVoiceStreamEvent,
  GetAgentRequest,
  InitializeAgentRequest,
  InterruptAgentVoicePlaybackRequest,
  InterruptAgentVoicePlaybackResponse,
  ReadArtifactBytesRequest,
  ReadArtifactBytesResponse,
  type AppMessageEvent,
  RuntimeTypedCallOptions,
  SendAppMessageRequest,
  SubscribeAgentEventsRequest,
  SubscribeAppMessagesRequest,
  SubscribeAgentVoiceStreamRequest,
  TerminateAgentRequest,
} from '../core-generated/runtime-typed-client';
import {
  AgentEventType,
  AgentLifecycleStatus,
  AgentPresentationEventFamily,
  ReasonCode as RuntimeGeneratedReasonCode,
  VoiceOutputMode,
  VoicePlaybackState,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode as SdkReasonCode } from '../types';
import {
  createNimiHostRuntimeAgentLifecycleSurface,
} from './runtime-agent-lifecycle';
import {
  buildNimiRuntimeAgentTurnPayload,
  createNimiRuntimeAgentTurnsModule,
} from './runtime-agent-turns';
import { createNimiRuntimeAgentVoiceModule } from './runtime-agent-voice';
import { fromNimiRuntimeProtoStruct, toNimiRuntimeProtoStruct, toNimiRuntimeTimestamp } from './runtime-agent-values';

const OWNER_USER_ID = 'user-1';
const RUNTIME_SOURCE_REF = 'agent-1';
const LOCAL_AGENT_REF = 'local-agent:test-user-1-agent-1';

test('Runtime Agent turn helpers build explicit payloads and fail closed on invalid input', async () => {
  const baseTurn = {
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    requestId: 'request-1',
    threadId: 'thread-1',
    worldId: 'world-1',
    systemPrompt: 'Stay concise',
    maxOutputTokens: 128,
    messages: [
      { role: 'user' as const, content: 'hello', name: 'Human' },
      { role: 'assistant' as const, content: '' },
    ],
    executionParams: {
      'image.generate': { size: '512x512', steps: 15 },
    },
    reasoning: { mode: 'visible', traceMode: 'summary', budgetTokens: 32 },
  };
  const payload = buildNimiRuntimeAgentTurnPayload(baseTurn);
  assert.equal(payload.local_agent_ref, LOCAL_AGENT_REF);
  assert.equal(payload.conversation_anchor_id, 'anchor-1');
  assert.deepEqual(payload.messages, [{ role: 'user', content: 'hello', name: 'Human' }]);
  // Atomic hard cut: turn payloads never carry execution_bindings; the
  // runtime resolves bindings from the committed Runtime Agent AI Config
  // (K-AGCORE-147) and rejects any request-level bindings.
  assert.equal('execution_bindings' in payload, false);
  assert.deepEqual(payload.execution_params, {
    'image.generate': {
      size: '512x512',
      steps: 15,
    },
  });
  assert.deepEqual(payload.reasoning, {
    mode: 'visible',
    trace_mode: 'summary',
    budget_tokens: 32,
  });

  assert.throws(
    () => buildNimiRuntimeAgentTurnPayload({ ...baseTurn, messages: [] }),
    /requires at least one non-empty message/,
  );
  assert.throws(
    () => buildNimiRuntimeAgentTurnPayload({ ...baseTurn, maxOutputTokens: -1 }),
    /maxOutputTokens must be non-negative/,
  );

  const sendCalls: SendAppMessageRequest[] = [];
  const scopes: readonly string[][] = [];
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
        },
        async *subscribeAgentEvents() {
          yield undefined;
        },
      },
      appMessages: {
        async sendAppMessage(request) {
          sendCalls.push(request);
          return { messageId: `message-${sendCalls.length}`, accepted: true, reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED };
        },
        async *subscribeAppMessages() {
          yield undefined as never;
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (nextScopes, operation) => {
      scopes.push(nextScopes);
      return operation({ metadata: { scoped: nextScopes.join(',') } });
    },
  });

  await module.request(baseTurn);
  assert.deepEqual(scopes[0], ['runtime.agent.turn.write']);
  assert.equal(sendCalls[0]?.messageType, 'runtime.agent.turn.request');
  assert.equal(sendCalls[0]?.subjectUserId, 'user-1');
  assert.equal(sendCalls[0]?.requireAck, false);
  assert.equal(fromNimiRuntimeProtoStruct(sendCalls[0]?.payload).conversation_anchor_id, 'anchor-1');

  await module.interrupt({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    reason: 'stop',
  });
  assert.deepEqual(scopes[1], ['runtime.agent.turn.write']);
  assert.equal(sendCalls[1]?.messageType, 'runtime.agent.turn.interrupt');
  assert.equal(fromNimiRuntimeProtoStruct(sendCalls[1]?.payload).turn_id, 'turn-1');

  const rejected = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
        },
        async *subscribeAgentEvents() {
          yield undefined;
        },
      },
      appMessages: {
        async sendAppMessage() {
          return { messageId: '', accepted: false, reasonCode: RuntimeGeneratedReasonCode.APP_GRANT_INVALID };
        },
        async *subscribeAppMessages() {
          yield undefined as never;
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (_scopes, operation) => operation({}),
  });
  await assert.rejects(
    () => rejected.request(baseTurn),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === SdkReasonCode.APP_GRANT_INVALID,
  );
});

test('Runtime Agent turn subscription without cursor starts at live boundary', async () => {
  const agentEventCalls: SubscribeAgentEventsRequest[] = [];
  const appMessageCalls: SubscribeAppMessagesRequest[] = [];
  const oldAccepted = {
    messageType: 'runtime.agent.turn.accepted',
    timestamp: toNimiRuntimeTimestamp(Date.now() - 60_000),
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: LOCAL_AGENT_REF,
      agent_id: LOCAL_AGENT_REF,
      conversation_anchor_id: 'anchor-1',
      turn_id: 'old-turn',
      stream_id: 'old-stream',
      detail: {},
    }),
  } as AppMessageEvent;
  const newVoiceChunk = {
    eventType: AgentEventType.PRESENTATION,
    sequence: '10',
    agentId: LOCAL_AGENT_REF,
    localAgentRef: LOCAL_AGENT_REF,
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    timestamp: toNimiRuntimeTimestamp(Date.now() + 1_000),
    detail: {
      oneofKind: 'presentation',
      presentation: {
        family: AgentPresentationEventFamily.VOICE_STREAM_CHUNK_AVAILABLE,
        conversationAnchorId: 'anchor-1',
        turnId: 'new-turn',
        streamId: 'new-stream',
        activityName: '',
        activityCategory: '',
        activityIntensity: '',
        activitySource: '',
        motionId: '',
        motionPriority: '',
        motionExpectedDurationMs: '0',
        expressionId: '',
        expressionExpectedDurationMs: '0',
        poseId: '',
        poseExpectedDurationMs: '0',
        previousPoseId: '',
        lookatTargetKind: '',
        lookatX: 0,
        lookatY: 0,
        lookatZ: 0,
        lookatHasX: false,
        lookatHasY: false,
        lookatHasZ: false,
        audioArtifactId: '',
        audioMimeType: 'audio/wav',
        voiceStreamId: 'voice-new',
        chunkTransportRef: 'runtime-agent-voice-stream://voice-new/chunks/000001',
        messageId: 'message-new',
        chunkSequence: '1',
        finalChunk: false,
        voiceOutputMode: VoiceOutputMode.NATIVE_STREAM,
        voicePlaybackState: VoicePlaybackState.ACTIVE,
        playbackTarget: 'avatar_autoplay',
        finalArtifact: false,
        terminalReason: '',
        reason: 'native_stream_chunk_available',
        durationMs: '0',
        deadlineOffsetMs: '0',
        finalArtifactId: '',
      },
    },
  } as AgentEvent;
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
        },
        subscribeAgentEvents(request) {
          agentEventCalls.push(request);
          return new CancellableStream<AgentEvent>([newVoiceChunk]);
        },
      },
      appMessages: {
        async sendAppMessage() {
          return { messageId: 'unused', accepted: true, reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED };
        },
        subscribeAppMessages(request) {
          appMessageCalls.push(request);
          return new CancellableStream<AppMessageEvent>([oldAccepted]);
        },
      },
    },
    getSubjectUserId: () => OWNER_USER_ID,
    withScopes: async (_scopes, operation) => operation({}),
  });

  const stream = await module.subscribe({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    includeAgentEvents: true,
  });
  const iterator = stream[Symbol.asyncIterator]();
  try {
    const next = await iterator.next();
    assert.equal(next.done, false);
    assert.equal(next.value.eventName, 'runtime.agent.presentation.voice_stream_chunk_available');
    assert.equal(next.value.turnId, 'new-turn');
    assert.equal(next.value.detail.voiceStreamId, 'voice-new');
    assert.equal((agentEventCalls[0] as { cursor?: string }).cursor, '');
    assert.equal((appMessageCalls[0] as { cursor?: string }).cursor, '');
  } finally {
    await iterator.return?.();
  }
});

test('Runtime Agent turn subscription opens live streams before caller pulls', async () => {
  let agentNextCount = 0;
  let appNextCount = 0;
  let agentReturnCount = 0;
  let appReturnCount = 0;
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
        },
        subscribeAgentEvents() {
          return trackedPendingStream<AgentEvent>({
            onNext: () => {
              agentNextCount += 1;
            },
            onReturn: () => {
              agentReturnCount += 1;
            },
          });
        },
      },
      appMessages: {
        async sendAppMessage() {
          return { messageId: 'unused', accepted: true, reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED };
        },
        subscribeAppMessages() {
          return trackedPendingStream<AppMessageEvent>({
            onNext: () => {
              appNextCount += 1;
            },
            onReturn: () => {
              appReturnCount += 1;
            },
          });
        },
      },
    },
    getSubjectUserId: () => OWNER_USER_ID,
    withScopes: async (_scopes, operation) => operation({}),
  });

  const stream = await module.subscribe({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    includeAgentEvents: true,
  });

  assert.equal(appNextCount, 1);
  assert.equal(agentNextCount, 1);
  await stream[Symbol.asyncIterator]().return?.();
  assert.equal(appReturnCount, 1);
  assert.equal(agentReturnCount, 1);
});

test('Runtime Agent turn subscription does not treat zero timestamp as stale live event', async () => {
  const oldAccepted = {
    messageType: 'runtime.agent.turn.accepted',
    timestamp: toNimiRuntimeTimestamp(Date.now() - 60_000),
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: LOCAL_AGENT_REF,
      agent_id: LOCAL_AGENT_REF,
      conversation_anchor_id: 'anchor-1',
      turn_id: 'old-turn',
      stream_id: 'old-stream',
      detail: {},
    }),
  } as AppMessageEvent;
  const zeroTimestampVoiceChunk = {
    messageType: 'runtime.agent.presentation.voice_stream_chunk_available',
    timestamp: toNimiRuntimeTimestamp(0),
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: LOCAL_AGENT_REF,
      agent_id: LOCAL_AGENT_REF,
      conversation_anchor_id: 'anchor-1',
      turn_id: 'new-turn',
      stream_id: 'new-stream',
      detail: {
        audio_mime_type: 'audio/wav',
        voice_stream_id: 'voice-zero-ts',
        chunk_transport_ref: 'runtime-agent-voice-stream://voice-zero-ts/chunks/000001',
        chunk_sequence: 1,
        final_chunk: false,
        voice_output_mode: 'native_stream',
        voice_playback_state: 'active',
        playback_target: 'avatar_autoplay',
      },
    }),
  } as AppMessageEvent;
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
        },
        subscribeAgentEvents() {
          return new CancellableStream<AgentEvent>([]);
        },
      },
      appMessages: {
        async sendAppMessage() {
          return { messageId: 'unused', accepted: true, reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED };
        },
        subscribeAppMessages() {
          return new CancellableStream<AppMessageEvent>([oldAccepted, zeroTimestampVoiceChunk]);
        },
      },
    },
    getSubjectUserId: () => OWNER_USER_ID,
    withScopes: async (_scopes, operation) => operation({}),
  });

  const stream = await module.subscribe({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    includeAgentEvents: false,
  });
  const iterator = stream[Symbol.asyncIterator]();
  try {
    const next = await iterator.next();
    assert.equal(next.done, false);
    assert.equal(next.value.eventName, 'runtime.agent.presentation.voice_stream_chunk_available');
    assert.equal(next.value.turnId, 'new-turn');
    assert.equal(next.value.detail.voiceStreamId, 'voice-zero-ts');
  } finally {
    await iterator.return?.();
  }
});

test('Runtime Agent turn helper requests committed-message voice render and resolves playable Runtime projection', async () => {
  const sendCalls: SendAppMessageRequest[] = [];
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
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
        },
        async *subscribeAgentEvents() {
          yield undefined;
        },
      },
      appMessages: {
        async sendAppMessage(request) {
          sendCalls.push(request);
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
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.status === 'ready' ? result.audioArtifactId : '', 'artifact-audio-1');
  assert.deepEqual(scopes, [
    ['runtime.agent.turn.read'],
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
  assert.equal(appStream.returnCount, 1);
});

test('Runtime Agent turn helper reports text_only when Runtime emits no playable voice projection', async () => {
  const appStream = new CancellableStream<AppMessageEvent>([]);
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
        },
        async *subscribeAgentEvents() {
          yield undefined;
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
    timeoutMs: 0,
  });

  assert.deepEqual(result, {
    status: 'text_only',
    reason: 'voice_projection_unavailable',
  });
  assert.equal(appStream.returnCount, 1);
});

test('Runtime Agent voice helper consumes typed stream and replays only audio artifacts', async () => {
  const scopes: readonly string[][] = [];
  const streamRequests: SubscribeAgentVoiceStreamRequest[] = [];
  const interruptRequests: InterruptAgentVoicePlaybackRequest[] = [];
  const artifactReads: ReadArtifactBytesRequest[] = [];
  const scopedBinding = {
    bindingId: 'binding-voice-1',
    bindingHandle: 'binding-handle-1',
    runtimeAppId: 'desktop',
    appInstanceId: 'desktop-instance-1',
    windowId: 'window-1',
    avatarInstanceId: 'avatar-1',
    agentId: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    worldId: 'world-1',
  };
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
      appAuth: protectedAppAuth(),
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
    scopedBinding,
  });
  const received: AgentVoiceStreamEvent[] = [];
  for await (const event of stream) {
    received.push(event);
  }
  assert.deepEqual([...received[0]?.chunk ?? []], [1, 2, 3]);
  assert.equal(streamRequests[0]?.voiceStreamId, 'voice-stream-1');
  assert.equal(streamRequests[0]?.context?.localAgentRef, LOCAL_AGENT_REF);
  assert.deepEqual(streamRequests[0]?.context?.scopedBinding, scopedBinding);
  assert.deepEqual(scopes[0], ['runtime.agent.turn.read']);

  const replay = await module.replayFinalArtifact({ artifactId: 'artifact-audio-1' });
  assert.deepEqual([...replay.bytes], [9, 8, 7]);
  assert.equal(artifactReads[0]?.artifactId, 'artifact-audio-1');
  await assert.rejects(
    () => module.replayFinalArtifact({ artifactId: 'artifact-text-1' }),
    /must be audio/,
  );
  const interrupt = await module.interruptPlayback({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    voiceStreamId: 'voice-stream-1',
    reason: 'avatar_user_interrupt',
    scopedBinding,
  });
  assert.equal(interrupt.voicePlaybackState, 3);
  assert.equal(interrupt.terminalReason, 'avatar_user_interrupt');
  assert.equal(interruptRequests[0]?.voiceStreamId, 'voice-stream-1');
  assert.equal(interruptRequests[0]?.conversationAnchorId, 'anchor-1');
  assert.equal(interruptRequests[0]?.turnId, 'turn-1');
  assert.equal(interruptRequests[0]?.context?.localAgentRef, LOCAL_AGENT_REF);
  assert.deepEqual(interruptRequests[0]?.context?.scopedBinding, scopedBinding);
  assert.deepEqual(scopes[1], ['runtime.agent.turn.write']);
});

test('Runtime Agent voice helper preserves injected metadata and supplies protected token when no Runtime binding exists', async () => {
  const streamOptions: RuntimeTypedCallOptions[] = [];
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
      appAuth: {
        async authorizeExternalPrincipal() {
          authCalls.push('authorize');
          return { tokenId: 'token-voice', secret: 'secret-voice' };
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
    withScopes: async (_nextScopes, operation) =>
      operation({ metadata: { scoped: 'voice-owner-binding' } }),
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

  assert.deepEqual(authCalls, ['register', 'authorize']);
  assert.equal(streamOptions[0]?.metadata?.scoped, 'voice-owner-binding');
  assert.equal(streamOptions[0]?.metadata?.['x-nimi-access-token-id'], 'token-voice');
  assert.equal(streamOptions[0]?.metadata?.['x-nimi-access-token-secret'], 'secret-voice');
});

test('Runtime Agent voice helper preserves scoped Runtime binding without renderer token fallback', async () => {
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
      appAuth: {
        async authorizeExternalPrincipal() {
          authCalls.push('authorize');
          throw new Error('Runtime protected token fallback must not run for Runtime auth bindings');
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
      metadata: { 'x-nimi-runtime-scoped-binding-id': 'binding-voice' },
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
  assert.equal(streamOptions[0]?.metadata?.['x-nimi-runtime-scoped-binding-id'], 'binding-voice');
  assert.equal(streamOptions[0]?.metadata?.['x-nimi-access-token-id'], undefined);
  const context = (streamRequests[0] as {
    readonly context?: {
      readonly scopedBinding?: {
        readonly bindingId?: string;
        readonly runtimeAppId?: string;
        readonly agentId?: string;
        readonly conversationAnchorId?: string;
      };
    };
  } | undefined)?.context;
  assert.equal(context?.scopedBinding?.bindingId, 'binding-voice');
  assert.equal(context?.scopedBinding?.runtimeAppId, 'avatar');
  assert.equal(context?.scopedBinding?.agentId, LOCAL_AGENT_REF);
  assert.equal(context?.scopedBinding?.conversationAnchorId, 'anchor-1');
});

test('Runtime Agent voice helper preserves host equivalence without renderer token fallback', async () => {
  const streamOptions: RuntimeTypedCallOptions[] = [];
  const authCalls: string[] = [];
  const module = createNimiRuntimeAgentVoiceModule({
    runtime: {
      appId: 'zhiyu',
      auth: {
        async registerApp() {
          authCalls.push('register');
          throw new Error('Runtime auth fallback must not run for Runtime host equivalence');
        },
      },
      appAuth: {
        async authorizeExternalPrincipal() {
          authCalls.push('authorize');
          throw new Error('Runtime protected token fallback must not run for Runtime host equivalence');
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
    withScopes: async (_nextScopes, operation) => operation({
      metadata: {
        'x-nimi-runtime-host-equivalence': 'runtime-sdk-authority:kit-electron-runtime-bridge-local-first-party-host',
      },
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
  assert.equal(
    streamOptions[0]?.metadata?.['x-nimi-runtime-host-equivalence'],
    'runtime-sdk-authority:kit-electron-runtime-bridge-local-first-party-host',
  );
  assert.equal(streamOptions[0]?.metadata?.['x-nimi-access-token-id'], undefined);
  assert.equal(streamOptions[0]?.metadata?.['x-nimi-access-token-secret'], undefined);
});

test('Runtime Agent turn subscription cancels sibling streams on early consumer exit', async () => {
  const appStream = new CancellableStream<AppMessageEvent>([{
    messageType: 'runtime.agent.turn.started',
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: LOCAL_AGENT_REF,
      conversation_anchor_id: 'anchor-1',
      turn_id: 'turn-1',
      stream_id: 'stream-1',
    }),
  } as AppMessageEvent]);
  const agentStream = new CancellableStream<unknown>([]);
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
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
          return { messageId: 'unused', accepted: true, reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED };
        },
        subscribeAppMessages() {
          return appStream;
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (_scopes, operation) => operation({}),
  });

  const stream = await module.subscribe({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    includeAgentEvents: true,
  });
  for await (const event of stream) {
    assert.equal(event.eventName, 'runtime.agent.turn.started');
    break;
  }

  assert.equal(appStream.returnCount, 1);
  assert.equal(agentStream.returnCount, 1);
});

test('Runtime Agent lifecycle surface initializes idempotently and terminates through scoped Runtime calls', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options?: RuntimeTypedCallOptions }> = [];
  let lifecycleStatus = AgentLifecycleStatus.ACTIVE;
  const surface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agent: {
        async getAgent(request: GetAgentRequest, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'getAgent', request, options });
          if (lifecycleStatus < 0) {
            throw createNimiError({
              message: 'not found',
              reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
              actionHint: 'check_runtime_agent',
              source: 'runtime',
            });
          }
          return { agent: { lifecycleStatus } };
        },
        async initializeAgent(request: InitializeAgentRequest, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'initializeAgent', request, options });
          return {
            agent: {
              agentId: LOCAL_AGENT_REF,
              localAgentRef: LOCAL_AGENT_REF,
              ownerUserId: OWNER_USER_ID,
              runtimeSourceRef: RUNTIME_SOURCE_REF,
              displayName: 'Agent One',
              lifecycleStatus: AgentLifecycleStatus.ACTIVE,
            },
          };
        },
        async terminateAgent(request: TerminateAgentRequest, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'terminateAgent', request, options });
          return {};
        },
      },
    }),
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });

  await surface.ensureLocalAgentInitialized(agentIdentity());
  assert.deepEqual(calls.map((call) => call.method), ['getAgent']);

  lifecycleStatus = -1;
  await surface.ensureLocalAgentInitialized({
    ...agentIdentity(),
    displayName: 'Agent One',
    worldId: 'world-1',
    sourceMaterializationPacket: { packetId: 'packet-1' },
  });
  assert.deepEqual(calls.map((call) => call.method), ['getAgent', 'getAgent', 'initializeAgent']);
  assert.equal((calls[2]?.request as InitializeAgentRequest).displayName, 'Agent One');
  assert.equal((calls[2]?.request as InitializeAgentRequest).worldId, 'world-1');
  assert.deepEqual((calls[2]?.request as InitializeAgentRequest).metadata, toNimiRuntimeProtoStruct({
    sourceMaterializationPacket: { packetId: 'packet-1' },
  }));
  assert.equal(calls[2]?.options?.metadata?.scopes, 'runtime.agent.admin');

  await surface.terminateLocalAgent({ ...agentIdentity(), reason: 'owner-requested' });
  assert.equal(calls[3]?.method, 'terminateAgent');
  assert.equal((calls[3]?.request as TerminateAgentRequest).agentId, LOCAL_AGENT_REF);
  assert.equal((calls[3]?.request as TerminateAgentRequest).reason, 'owner-requested');
});

test('Runtime Agent lifecycle materialization returns Runtime-generated localAgentRef', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options?: RuntimeTypedCallOptions }> = [];
  const surface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agent: {
        async getAgent() {
          throw new Error('initializeLocalAgent must not read by caller localAgentRef');
        },
        async initializeAgent(request: InitializeAgentRequest, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'initializeAgent', request, options });
          return {
            agent: {
              agentId: 'local-agent:runtime-generated-1',
              localAgentRef: 'local-agent:runtime-generated-1',
              ownerUserId: OWNER_USER_ID,
              runtimeSourceRef: RUNTIME_SOURCE_REF,
              displayName: 'Runtime Generated Agent',
              lifecycleStatus: AgentLifecycleStatus.ACTIVE,
            },
          };
        },
        async terminateAgent() {
          return {};
        },
      },
    }),
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });

  const result = await surface.initializeLocalAgent({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    displayName: 'Runtime Generated Agent',
    sourceMaterializationPacket: { packetId: 'packet-runtime-generated' },
  });

  assert.equal(result.localAgentRef, 'local-agent:runtime-generated-1');
  assert.deepEqual(calls.map((call) => call.method), ['initializeAgent']);
  const request = calls[0]?.request as InitializeAgentRequest;
  assert.equal(request.localAgentRef, '');
  assert.equal(request.context?.localAgentRef, '');
  assert.equal(request.ownerUserId, OWNER_USER_ID);
  assert.equal(request.runtimeSourceRef, RUNTIME_SOURCE_REF);
  assert.equal(calls[0]?.options?.metadata?.scopes, 'runtime.agent.admin');
});

test('Runtime Agent lifecycle rejects initialize responses without Runtime-owned localAgentRef', async () => {
  const surface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agent: {
        async getAgent() {
          throw new Error('initializeLocalAgent must not read before initialize');
        },
        async initializeAgent() {
          return {
            agent: {
              ownerUserId: OWNER_USER_ID,
              runtimeSourceRef: RUNTIME_SOURCE_REF,
              displayName: 'Missing Runtime Identity',
              lifecycleStatus: AgentLifecycleStatus.ACTIVE,
            },
          };
        },
        async terminateAgent() {
          return {};
        },
      },
    }),
    getSubjectUserId: () => 'user-1',
    withScopes: async (_scopes, operation) => operation({}),
  });

  await assert.rejects(
    () => surface.initializeLocalAgent({
      localAgentRef: 'local-agent:caller-authored-ref',
      ownerUserId: OWNER_USER_ID,
      runtimeSourceRef: RUNTIME_SOURCE_REF,
      displayName: 'Missing Runtime Identity',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
  );
});

test('Runtime Agent lifecycle fails closed instead of synthesizing AlreadyExists success', async () => {
  const surface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agent: {
        async getAgent() {
          throw new Error('initializeLocalAgent must not read before initialize');
        },
        async initializeAgent() {
          throw createNimiError({
            message: 'local agent already exists',
            reasonCode: 'RUNTIME_GRPC_ALREADY_EXISTS',
            actionHint: 'read_runtime_owned_local_agent_projection',
            source: 'runtime',
          });
        },
        async terminateAgent() {
          return {};
        },
      },
    }),
    getSubjectUserId: () => 'user-1',
    withScopes: async (_scopes, operation) => operation({}),
  });

  await assert.rejects(
    () => surface.initializeLocalAgent({
      localAgentRef: 'local-agent:caller-authored-ref',
      ownerUserId: OWNER_USER_ID,
      runtimeSourceRef: RUNTIME_SOURCE_REF,
      displayName: 'Already Exists Agent',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'RUNTIME_GRPC_ALREADY_EXISTS',
  );
});

test('Runtime Agent lifecycle discovers existing LocalAgents through Runtime inventory provenance', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options?: RuntimeTypedCallOptions }> = [];
  const matchingLocalAgentRef = 'local-agent:runtime-owned-existing';
  const surface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agent: {
        async getAgent() {
          throw new Error('discoverLocalAgentsBySource must not require caller localAgentRef');
        },
        async initializeAgent() {
          throw new Error('discoverLocalAgentsBySource must not materialize');
        },
        async listAgents(request: unknown, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'listAgents', request, options });
          if ((request as { readonly pageToken?: string }).pageToken === 'page-2') {
            return {
              agents: [
                {
                  agentId: matchingLocalAgentRef,
                  localAgentRef: matchingLocalAgentRef,
                  ownerUserId: OWNER_USER_ID,
                  runtimeSourceRef: 'runtime-source:worldCharacter:world-1:source-1:hash-1',
                  displayName: 'Existing Source Agent',
                  lifecycleStatus: AgentLifecycleStatus.ACTIVE,
                  metadata: toNimiRuntimeProtoStruct({
                    sourceMaterialization: {
                      sourceKind: 'worldCharacter',
                      sourceWorldId: 'world-1',
                      sourceId: 'source-1',
                      sourceContentHash: 'hash-1',
                    },
                  }),
                },
              ],
              nextPageToken: '',
            };
          }
          return {
            agents: [
              {
                agentId: 'local-agent:other-owner',
                localAgentRef: 'local-agent:other-owner',
                ownerUserId: 'other-user',
                runtimeSourceRef: 'runtime-source:worldCharacter:world-1:source-1:hash-1',
                lifecycleStatus: AgentLifecycleStatus.ACTIVE,
              },
              {
                agentId: 'local-agent:stale-hash',
                localAgentRef: 'local-agent:stale-hash',
                ownerUserId: OWNER_USER_ID,
                runtimeSourceRef: 'runtime-source:worldCharacter:world-1:source-1:stale',
                lifecycleStatus: AgentLifecycleStatus.ACTIVE,
              },
            ],
            nextPageToken: 'page-2',
          };
        },
        async terminateAgent() {
          return {};
        },
      },
    }),
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });

  const discovered = await surface.discoverLocalAgentsBySource({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: 'runtime-source:worldCharacter:world-1:source-1:hash-1',
    sourceRef: {
      kind: 'worldCharacter',
      worldId: 'world-1',
      sourceId: 'source-1',
      sourceContentHash: 'hash-1',
    },
  });

  assert.deepEqual(discovered.map((agent) => agent.localAgentRef), [matchingLocalAgentRef]);
  assert.deepEqual(calls.map((call) => call.method), ['listAgents', 'listAgents']);
  assert.deepEqual(calls.map((call) => (call.request as { readonly pageToken?: string }).pageToken), ['', 'page-2']);
  assert.equal(calls[1]?.options?.metadata?.scopes, 'runtime.agent.read');
});

test('Runtime Agent lifecycle discovers source provenance without caller runtimeSourceRef', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options?: RuntimeTypedCallOptions }> = [];
  const matchingLocalAgentRef = 'local-agent:runtime-owned-source-only';
  const runtimeSourceRef = 'runtime-source:worldCharacter:world-1:source-1:hash-1';
  const surface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agent: {
        async getAgent() {
          throw new Error('source provenance discovery must not require caller localAgentRef');
        },
        async initializeAgent() {
          throw new Error('source provenance discovery must not materialize');
        },
        async listAgents(request: unknown, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'listAgents', request, options });
          return {
            agents: [
              {
                agentId: matchingLocalAgentRef,
                localAgentRef: matchingLocalAgentRef,
                ownerUserId: OWNER_USER_ID,
                runtimeSourceRef,
                displayName: 'Existing Source Agent',
                lifecycleStatus: AgentLifecycleStatus.ACTIVE,
                metadata: toNimiRuntimeProtoStruct({
                  sourceMaterialization: {
                    sourceKind: 'worldCharacter',
                    sourceWorldId: 'world-1',
                    sourceId: 'source-1',
                    sourceContentHash: 'hash-1',
                  },
                }),
              },
            ],
            nextPageToken: '',
          };
        },
        async terminateAgent() {
          return {};
        },
      },
    }),
    getSubjectUserId: () => OWNER_USER_ID,
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });

  const discovered = await surface.discoverLocalAgentsBySource({
    ownerUserId: OWNER_USER_ID,
    sourceRef: {
      kind: 'worldCharacter',
      worldId: 'world-1',
      sourceId: 'source-1',
      sourceContentHash: 'hash-1',
    },
  });

  assert.deepEqual(discovered.map((agent) => agent.localAgentRef), [matchingLocalAgentRef]);
  assert.equal(discovered[0]?.runtimeSourceRef, runtimeSourceRef);
  assert.deepEqual(calls.map((call) => call.method), ['listAgents']);
  assert.equal(calls[0]?.options?.metadata?.scopes, 'runtime.agent.read');
});

class CancellableStream<T> implements AsyncIterable<T> {
  private readonly values: T[];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  returnCount = 0;

  constructor(values: readonly T[]) {
    this.values = [...values];
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        if (this.values.length > 0) {
          return { done: false, value: this.values.shift() as T };
        }
        if (this.closed) {
          return { done: true, value: undefined };
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
      return: async () => {
        this.returnCount += 1;
        this.closed = true;
        this.values.length = 0;
        while (this.waiters.length > 0) {
          this.waiters.shift()?.({ done: true, value: undefined });
        }
        return { done: true, value: undefined };
      },
    };
  }
}

function trackedPendingStream<T>(hooks: {
  readonly onNext: () => void;
  readonly onReturn: () => void;
}): AsyncIterable<T> {
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: async () => {
          hooks.onNext();
          if (closed) {
            return { done: true, value: undefined };
          }
          return new Promise<IteratorResult<T>>((resolve) => {
            waiters.push(resolve);
          });
        },
        return: async () => {
          closed = true;
          hooks.onReturn();
          while (waiters.length > 0) {
            waiters.shift()?.({ done: true, value: undefined });
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}

function agentIdentity() {
  return {
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
  };
}

function protectedAuth() {
  return {
    async registerApp() {
      return { accepted: true };
    },
  };
}

function protectedAppAuth() {
  return {
    async authorizeExternalPrincipal() {
      return { tokenId: 'token-1', secret: 'secret-1' };
    },
  };
}
