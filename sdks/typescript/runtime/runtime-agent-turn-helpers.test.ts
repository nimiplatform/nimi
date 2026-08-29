import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiRuntimeAgentTurnRequest } from './runtime-agent-turn-runner-types';

import {
  AgentLifecycleStatus,
  CancellableStream,
  LOCAL_AGENT_REF,
  OWNER_USER_ID,
  RUNTIME_SOURCE_REF,
  RuntimeGeneratedReasonCode,
  SdkReasonCode,
  agentIdentity,
  buildNimiRuntimeAgentTurnPayload,
  createNimiError,
  createNimiHostRuntimeAgentLifecycleSurface,
  createNimiRuntimeAgentTurnsModule,
  fromNimiRuntimeProtoStruct,
  protectedAuth,
  toNimiRuntimeProtoStruct,
  toNimiRuntimeTimestamp,
  trackedPendingStream,
  type AppMessageEvent,
  type GetAgentRequest,
  type RuntimeTypedCallOptions,
  type SendAppMessageRequest,
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
    messageType: 'runtime.agent.conversation.voice_artifact_available',
    timestamp: toNimiRuntimeTimestamp(Date.now() + 1_000),
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: LOCAL_AGENT_REF,
      conversation_anchor_id: 'anchor-1',
      turn_id: 'new-turn',
      stream_id: 'new-stream',
      detail: {
        audio_artifact_id: 'artifact-voice-new',
        audio_mime_type: 'audio/wav',
        message_id: 'message-new',
        artifact_sequence: 1,
        artifact_complete: true,
        voice_timing_phase: 'active',
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
      },
      appMessages: {
        async sendAppMessage() {
          return { messageId: 'unused', accepted: true, reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED };
        },
        subscribeAppMessages(request) {
          appMessageCalls.push(request);
          return new CancellableStream<AppMessageEvent>([oldAccepted, newVoiceChunk]);
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
  });
  const iterator = stream[Symbol.asyncIterator]();
  try {
    const next = await iterator.next();
    assert.equal(next.done, false);
    assert.equal(next.value.eventName, 'runtime.agent.conversation.voice_artifact_available');
    assert.equal(next.value.turnId, 'new-turn');
    assert.equal(next.value.detail.audioArtifactId, 'artifact-voice-new');
    assert.equal((appMessageCalls[0] as { cursor?: string }).cursor, '');
  } finally {
    await iterator.return?.();
  }
});

test('Runtime Agent turn subscription opens the App stream without prefetching events', async () => {
  let appNextCount = 0;
  let appReturnCount = 0;
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
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
  });

  assert.equal(appNextCount, 0);
  await stream[Symbol.asyncIterator]().return?.();
  assert.equal(appReturnCount, 1);
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
    messageType: 'runtime.agent.conversation.voice_artifact_available',
    timestamp: toNimiRuntimeTimestamp(0),
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: LOCAL_AGENT_REF,
      agent_id: LOCAL_AGENT_REF,
      conversation_anchor_id: 'anchor-1',
      turn_id: 'new-turn',
      stream_id: 'new-stream',
      detail: {
        audio_artifact_id: 'artifact-voice-zero-ts',
        audio_mime_type: 'audio/wav',
        artifact_sequence: 1,
        artifact_complete: true,
        voice_timing_phase: 'active',
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
  });
  const iterator = stream[Symbol.asyncIterator]();
  try {
    const next = await iterator.next();
    assert.equal(next.done, false);
    assert.equal(next.value.eventName, 'runtime.agent.conversation.voice_artifact_available');
    assert.equal(next.value.turnId, 'new-turn');
    assert.equal(next.value.detail.audioArtifactId, 'artifact-voice-zero-ts');
  } finally {
    await iterator.return?.();
  }
});

test('Runtime Agent turn subscription cancels the App message stream on early consumer exit', async () => {
  const appStream = new CancellableStream<AppMessageEvent>([{
    messageType: 'runtime.agent.turn.started',
    payload: toNimiRuntimeProtoStruct({
      conversation_anchor_id: 'anchor-1',
      turn_id: 'turn-1',
      stream_id: 'stream-1',
    }),
  } as AppMessageEvent]);
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
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
  });
  for await (const event of stream) {
    assert.equal(event.eventName, 'runtime.agent.turn.started');
    assert.equal(event.localAgentRef, LOCAL_AGENT_REF);
    break;
  }

  assert.equal(appStream.returnCount, 1);
});
