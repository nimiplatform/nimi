import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CreateRealmGroupMessageCandidateRequest,
  GetAgentRequest,
  GetRealmGroupMessageCandidateEvidenceRequest,
  InitializeAgentRequest,
  type AppMessageEvent,
  RuntimeTypedCallOptions,
  SendAppMessageRequest,
  TerminateAgentRequest,
} from '../core-generated/runtime-typed-client';
import {
  AgentLifecycleStatus,
  ReasonCode as RuntimeGeneratedReasonCode,
  RealmGroupMessageCandidateCommitDisposition,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode as SdkReasonCode } from '../types';
import { buildRuntimeLocalAgentRef } from './agent-local-identity';
import {
  createNimiHostRuntimeAgentLifecycleSurface,
} from './runtime-agent-lifecycle';
import {
  createNimiHostRuntimeRealmGroupMessageCandidateSurface,
} from './runtime-agent-group-message';
import {
  buildNimiRuntimeAgentTurnPayload,
  createNimiRuntimeAgentTurnsModule,
} from './runtime-agent-turns';
import { fromNimiRuntimeProtoStruct, toNimiRuntimeProtoStruct } from './runtime-agent-values';

test('Runtime Agent turn helpers build explicit payloads and fail closed on invalid input', async () => {
  const baseTurn = {
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
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
    executionBindings: {
      'text.generate': { route: 'local' as const, modelId: 'local-model', connectorId: 'local-connector' },
      'image.generate': { route: 'local' as const, modelId: 'image-model' },
    },
    executionParams: {
      'image.generate': { size: '512x512', steps: 15 },
    },
    reasoning: { mode: 'visible', traceMode: 'summary', budgetTokens: 32 },
  };
  const payload = buildNimiRuntimeAgentTurnPayload(baseTurn);
  assert.equal(payload.local_agent_ref, 'local-agent:user-1:agent-1');
  assert.equal(payload.conversation_anchor_id, 'anchor-1');
  assert.deepEqual(payload.messages, [{ role: 'user', content: 'hello', name: 'Human' }]);
  assert.deepEqual(payload.execution_bindings, {
    'text.generate': {
      route: 'local',
      model_id: 'local-model',
      connector_id: 'local-connector',
    },
    'image.generate': {
      route: 'local',
      model_id: 'image-model',
    },
  });
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
    () => buildNimiRuntimeAgentTurnPayload({
      ...baseTurn,
      executionBindings: {
        'text.generate': { route: 'edge' as never, modelId: 'model' },
      },
    }),
    /route must be local or cloud/,
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
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
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

test('Runtime Agent turn helper requests committed-message voice render and resolves playable Runtime projection', async () => {
  const sendCalls: SendAppMessageRequest[] = [];
  const scopes: readonly string[][] = [];
  const voiceEvent = {
    messageType: 'runtime.agent.presentation.voice_playback_requested',
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: 'local-agent:user-1:agent-1',
      agent_id: 'local-agent:user-1:agent-1',
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
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
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
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
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

test('Runtime Agent turn subscription cancels sibling streams on early consumer exit', async () => {
  const appStream = new CancellableStream<AppMessageEvent>([{
    messageType: 'runtime.agent.turn.started',
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: 'local-agent:user-1:agent-1',
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
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
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
          return {};
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
  await surface.ensureLocalAgentInitialized({ ...agentIdentity(), displayName: 'Agent One', worldId: 'world-1' });
  assert.deepEqual(calls.map((call) => call.method), ['getAgent', 'getAgent', 'initializeAgent']);
  assert.equal((calls[2]?.request as InitializeAgentRequest).displayName, 'Agent One');
  assert.equal((calls[2]?.request as InitializeAgentRequest).worldId, 'world-1');
  assert.equal(calls[2]?.options?.metadata?.scopes, 'runtime.agent.admin');

  await surface.terminateLocalAgent({ ...agentIdentity(), reason: 'owner-requested' });
  assert.equal(calls[3]?.method, 'terminateAgent');
  assert.equal((calls[3]?.request as TerminateAgentRequest).agentId, 'local-agent:user-1:agent-1');
  assert.equal((calls[3]?.request as TerminateAgentRequest).reason, 'owner-requested');
});

test('Runtime Realm group message candidate surface builds verified commit payloads and rejects mismatched evidence', async () => {
  const createCalls: CreateRealmGroupMessageCandidateRequest[] = [];
  const evidenceCalls: GetRealmGroupMessageCandidateEvidenceRequest[] = [];
  const candidate = candidateHandle();
  let evidence = candidateEvidence();
  const surface = createNimiHostRuntimeRealmGroupMessageCandidateSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agent: {
        async createRealmGroupMessageCandidate(request) {
          createCalls.push(request);
          return { candidate };
        },
        async getRealmGroupMessageCandidateEvidence(request) {
          evidenceCalls.push(request);
          return { evidence };
        },
      },
    }),
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });

  const result = await surface.createCommitPayload({
    ...agentIdentity(),
    participantType: 'source',
    currentUserId: 'user-1',
    runtimeParticipantSlot: 'slot-1',
    realmGroupThreadId: 'thread-1',
    triggerMessageId: 'message-1',
    idempotencyKey: 'idem-1',
  });

  assert.equal(createCalls[0]?.triggerRef, 'realm://group-chats/thread-1/messages/message-1');
  assert.equal(createCalls[0]?.contextRefs['realm.group.thread.snapshot'], 'realm-context://group-chats/thread-1/thread/current');
  assert.equal('custom' in (createCalls[0]?.contextRefs ?? {}), false);
  assert.equal(evidenceCalls[0]?.candidateId, 'candidate-1');
  assert.equal(result.realmCommitPayload.commitDisposition, 'MESSAGE_CANDIDATE');
  assert.equal(result.realmCommitPayload.body, 'hello group');
  assert.equal(result.realmCommitPayload.idempotencyKey, 'idem-1');
  assert.equal(result.realmCommitPayload.expectedRuntimeParticipantSlotId, 'slot-1');
  assert.equal(result.realmCommitPayload.expectedRuntimeSourceRef, 'agent-1');
  assert.equal(result.realmCommitPayload.createdAt, '2026-06-05T00:00:00.000Z');

  evidence = { ...candidateEvidence(), candidateId: 'other-candidate' };
  await assert.rejects(
    () => surface.createCommitPayload({
      ...agentIdentity(),
      participantType: 'source',
      currentUserId: 'user-1',
      runtimeParticipantSlot: 'slot-1',
      realmGroupThreadId: 'thread-1',
      triggerMessageId: 'message-1',
      idempotencyKey: 'idem-2',
    }),
    /evidence does not match the candidate handle/,
  );

  await assert.rejects(
    () => surface.createCommitPayload({
      ...agentIdentity(),
      participantType: 'source',
      currentUserId: 'user-1',
      runtimeParticipantSlot: 'slot-1',
      realmGroupThreadId: 'thread-1',
      triggerMessageId: 'message-1',
      idempotencyKey: 'idem-3',
      contextRefs: { custom: 'realm-context://custom' },
    } as never),
    /context refs are Runtime-owned/,
  );
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

function agentIdentity() {
  return {
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: buildRuntimeLocalAgentRef({ ownerUserId: 'user-1', runtimeSourceRef: 'agent-1' }),
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

function timestamp(iso: string): { readonly seconds: string; readonly nanos: number } {
  const millis = Date.parse(iso);
  return {
    seconds: String(Math.floor(millis / 1000)),
    nanos: (millis % 1000) * 1_000_000,
  };
}

function candidateHandle() {
  return {
    candidateId: 'candidate-1',
    candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE',
    candidateEvidenceRef: 'evidence-ref-1',
    evidenceHash: 'hash-1',
    runtimeTraceRef: 'trace-1',
    realmGroupThreadId: 'thread-1',
    runtimeParticipantSlot: 'slot-1',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    triggerRef: 'realm://group-chats/thread-1/messages/message-1',
    outputCandidateRef: 'candidate-output-1',
    auditLineageRef: 'audit-1',
    policyVerdictRef: 'policy-1',
    createdAt: timestamp('2026-06-05T00:00:00.000Z'),
    expiresAt: timestamp('2026-06-05T00:05:00.000Z'),
    commitDisposition: RealmGroupMessageCandidateCommitDisposition.MESSAGE_CANDIDATE,
  };
}

function candidateEvidence() {
  return {
    candidateId: 'candidate-1',
    candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE',
    realmGroupThreadId: 'thread-1',
    runtimeParticipantSlot: 'slot-1',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    triggerRef: 'realm://group-chats/thread-1/messages/message-1',
    outputCandidateRef: 'candidate-output-1',
    evidenceHash: 'hash-1',
    runtimeTraceRef: 'trace-1',
    auditLineageRef: 'audit-1',
    policyVerdictRef: 'policy-1',
    createdAt: timestamp('2026-06-05T00:00:00.000Z'),
    expiresAt: timestamp('2026-06-05T00:05:00.000Z'),
    commitDisposition: RealmGroupMessageCandidateCommitDisposition.MESSAGE_CANDIDATE,
    messageType: 'TEXT',
    body: 'hello group',
    bodyHash: 'body-hash-1',
    refusalCode: '',
    refusalReason: '',
    refusalHash: '',
  };
}
