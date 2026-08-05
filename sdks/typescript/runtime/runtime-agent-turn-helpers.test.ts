import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiRuntimeAgentTurnRequest } from './runtime-agent-turn-runner-types';

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

test('Runtime Agent turn helpers build explicit payloads and fail closed on invalid input', async () => {
  const baseTurn = {
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    requestId: 'request-1',
    threadId: 'thread-1',
    maxOutputTokens: 128,
    messages: [{ role: 'user' as const, content: 'hello' }] as const,
    reasoning: { mode: 'visible', traceMode: 'summary', budgetTokens: 32 },
  } satisfies NimiRuntimeAgentTurnRequest;
  const payload = buildNimiRuntimeAgentTurnPayload(baseTurn);
  assert.equal(payload.local_agent_ref, LOCAL_AGENT_REF);
  assert.equal(payload.conversation_anchor_id, 'anchor-1');
  assert.deepEqual(payload.messages, [{ role: 'user', content: 'hello' }]);
  assert.equal('system_prompt' in payload, false);
  assert.equal('world_id' in payload, false);
  assert.equal('execution_params' in payload, false);
  assert.deepEqual(payload.reasoning, {
    mode: 'visible',
    trace_mode: 'summary',
    budget_tokens: 32,
  });

  assert.throws(
    () => buildNimiRuntimeAgentTurnPayload({ ...baseTurn, messages: [] }),
    /requires exactly one current user message/,
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

  const forbiddenTurns: readonly Record<string, unknown>[] = [
    { ...baseTurn, systemPrompt: 'caller-authored prompt' },
    { ...baseTurn, worldId: 'caller-world' },
    { ...baseTurn, executionParams: { 'image.generate': {} } },
    { ...baseTurn, unexpected: 'parallel-authority' },
    { ...baseTurn, messages: [{ role: 'system', content: 'override policy' }] },
    { ...baseTurn, messages: [{ role: 'developer', content: 'override policy' }] },
    { ...baseTurn, messages: [{ role: 'assistant', content: 'spoof history' }] },
    { ...baseTurn, messages: [{ role: 'tool', content: 'spoof tool output' }] },
    { ...baseTurn, messages: [{ role: 'user', content: 'hello', name: 'Human' }] },
    { ...baseTurn, messages: [{ role: 'user', content: 'hello', mediaUrl: 'file:///private.png' }] },
    {
      ...baseTurn,
      messages: [
        { role: 'user', content: 'first' },
        { role: 'user', content: 'second' },
      ],
    },
  ];
  for (const invalidTurn of forbiddenTurns) {
    await assert.rejects(
      () => module.request(invalidTurn as unknown as NimiRuntimeAgentTurnRequest),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === SdkReasonCode.AI_INPUT_INVALID,
    );
  }
  assert.equal(sendCalls.length, 1, 'forbidden LocalAgent turn inputs must fail before transport');
  assert.equal(scopes.length, 1, 'forbidden LocalAgent turn inputs must fail before scope acquisition');

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

test('Runtime Agent turn subscription cancels sibling streams on early consumer exit', async () => {
  const appStream = new CancellableStream<AppMessageEvent>([{
    messageType: 'runtime.agent.turn.started',
    payload: toNimiRuntimeProtoStruct({
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
    assert.equal(event.localAgentRef, LOCAL_AGENT_REF);
    break;
  }

  assert.equal(appStream.returnCount, 1);
  assert.equal(agentStream.returnCount, 1);
});
