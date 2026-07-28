import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentCanonicalMemoryBankMode,
  AgentEventType,
  AvatarDebugProbeKind,
  AvatarDebugRequestedBy,
  CompanionParticipationStatus,
  CompanionParticipationSurfaceKind,
  CompanionParticipationTriggerSource,
  ConversationAnchorStatus,
  DelegatedApprovalDecision,
  HookAdmissionState,
  NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
  asyncEvents,
  buildNimiRuntimeAgentConsumeContext,
  buildNimiRuntimeAgentResolvedOutputText,
  buildNimiRuntimeAgentSnapshotRecoveryEvents,
  cloneNimiRuntimeAgentResolvedMessageActionEnvelopeWithCommittedMessage,
  collectAsyncIterable,
  consumeContext,
  createNimiHostRuntimeAgentDelegatedControlSurface,
  createNimiHostRuntimeAgentMemorySurface,
  createNimiRuntimeAgentConsumeClient,
  createUnexpectedRuntimeAgentConsumeRuntime,
  decodeNimiRuntimeAgentCompanionParticipationProjection,
  isNimiRuntimeAgentProjectionEvent,
  matchesNimiRuntimeAgentProjectionScope,
  nimiRuntimeAgentSnapshotCompletedTurnHasRecoverableContent,
  nimiRuntimeAgentSnapshotTurnIsCompleted,
  nimiRuntimeAgentSnapshotTurnIsFailed,
  nimiRuntimeAgentSnapshotTurnIsTerminal,
  parseNimiRuntimeAgentResolvedMessageActionEnvelopeFromPayload,
  parseNimiRuntimeAgentStructuredMessageActionEnvelope,
  parseNimiRuntimeAgentTimeline,
  projectNimiRuntimeAgentAppMessageEvent,
  projectNimiRuntimeAgentCanonicalMemoryBankStatus,
  readNimiRuntimeAgentStructuredMessageField,
  recoverNimiRuntimeAgentTerminalSnapshot,
  summarizeNimiRuntimeAgentProjectionEvent,
  summarizeNimiRuntimeAgentTimeline,
  type AppMessageEvent,
  type NimiRuntimeAgentConsumeEvent,
  type NimiRuntimeAgentConsumeRuntime,
  type NimiRuntimeAgentSessionTurnSnapshot,
} from './runtime-agent-consume.test-helper';

test('Runtime Agent message-action helpers parse structured envelopes and fail closed', () => {
  const envelope = parseNimiRuntimeAgentStructuredMessageActionEnvelope({
    message: {
      message_id: 'assistant-1',
      text: 'Paint the gate and speak the cue.',
    },
    status_cue: {
      source_message_id: 'assistant-1',
      mood: 'happy',
      label: 'Ready',
      intensity: 0.8,
      action_cue: 'show-and-say',
    },
    actions: [
      {
        action_id: 'image-1',
        action_index: 0,
        action_count: 2,
        modality: 'image',
        operation: 'generate',
        prompt_payload: { prompt_text: 'A bright sky gate' },
        source_message_id: 'assistant-1',
        delivery_coupling: 'after-message',
      },
      {
        action_id: 'voice-1',
        action_index: 1,
        action_count: 2,
        modality: 'voice',
        operation: 'synthesize',
        prompt_payload: { prompt_text: 'Welcome to the sky gate.' },
        source_message_id: 'assistant-1',
        delivery_coupling: 'with-message',
      },
    ],
  });

  assert.equal(envelope.schemaId, NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID);
  assert.equal(envelope.statusCue?.mood, 'happy');
  assert.equal(envelope.actions[0]?.promptPayload.kind, 'image-prompt');
  assert.equal(envelope.actions[1]?.promptPayload.kind, 'voice-prompt');
  assert.equal(buildNimiRuntimeAgentResolvedOutputText(envelope), 'Paint the gate and speak the cue.');

  const committed = cloneNimiRuntimeAgentResolvedMessageActionEnvelopeWithCommittedMessage({
    envelope,
    messageId: 'committed-1',
    text: 'Committed text',
  });
  assert.equal(committed.message.messageId, 'committed-1');
  assert.equal(committed.statusCue?.sourceMessageId, 'committed-1');
  assert.equal(committed.actions[0]?.sourceMessageId, 'committed-1');

  assert.throws(
    () => parseNimiRuntimeAgentResolvedMessageActionEnvelopeFromPayload({
      schemaId: NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
      message: { messageId: 'assistant-1', text: 'hello' },
      statusCue: { sourceMessageId: 'assistant-1', mood: 'joy' },
      actions: [],
    }),
    /statusCue\.mood is invalid/u,
  );
  assert.throws(
    () => parseNimiRuntimeAgentResolvedMessageActionEnvelopeFromPayload({
      schemaId: NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
      message: { messageId: 'assistant-1', text: 'hello' },
      actions: [
        {
          actionId: 'image-1',
          actionIndex: 0,
          actionCount: 2,
          modality: 'image',
          operation: 'generate',
          promptPayload: { kind: 'image-prompt', promptText: 'one' },
          sourceMessageId: 'assistant-1',
          deliveryCoupling: 'after-message',
        },
        {
          actionId: 'image-2',
          actionIndex: 1,
          actionCount: 2,
          modality: 'image',
          operation: 'generate',
          promptPayload: { kind: 'image-prompt', promptText: 'two' },
          sourceMessageId: 'assistant-1',
          deliveryCoupling: 'after-message',
        },
      ],
    }),
    /at most one image action/u,
  );
  assert.throws(
    () => parseNimiRuntimeAgentStructuredMessageActionEnvelope({
      message: { message_id: 'assistant-1', text: 'hello' },
      actions: [{
        action_id: 'voice-1',
        action_index: 1,
        action_count: 1,
        modality: 'voice',
        operation: 'synthesize',
        prompt_payload: { prompt_text: 'hello' },
        source_message_id: 'assistant-1',
        delivery_coupling: 'with-message',
      }],
    }),
    /actionIndex must equal 0/u,
  );
});

test('Runtime Agent memory helpers project canonical status and bind envelopes', async () => {
  assert.deepEqual(projectNimiRuntimeAgentCanonicalMemoryBankStatus({
    mode: AgentCanonicalMemoryBankMode.STANDARD,
    bankId: 'bank-1',
    embeddingProfile: { modelId: 'embed-model' },
    bindingSourceKind: 'runtime',
    blockedReasonCode: 'AI_MODEL_NOT_READY',
    pendingCutover: true,
    canonicalBankStatus: 'ready',
    bindAllowed: true,
    cutoverAllowed: false,
  }), {
    mode: 'standard',
    bankId: 'bank-1',
    embeddingProfileModelId: 'embed-model',
    bindingSourceKind: 'runtime',
    blockedReasonCode: 'AI_MODEL_NOT_READY',
    pendingCutover: true,
    canonicalBankStatus: 'ready',
    bindAllowed: true,
    cutoverAllowed: false,
  });
  assert.equal(projectNimiRuntimeAgentCanonicalMemoryBankStatus({
    mode: AgentCanonicalMemoryBankMode.BASELINE,
  }).mode, 'baseline');
  assert.equal(projectNimiRuntimeAgentCanonicalMemoryBankStatus({
    mode: AgentCanonicalMemoryBankMode.UNAVAILABLE,
  }).mode, 'unavailable');
  assert.throws(
    () => projectNimiRuntimeAgentCanonicalMemoryBankStatus(undefined),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_CANONICAL_MEMORY_STATUS_REQUIRED');
      return true;
    },
  );
  assert.throws(
    () => projectNimiRuntimeAgentCanonicalMemoryBankStatus({
      mode: AgentCanonicalMemoryBankMode.UNSPECIFIED,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_CANONICAL_MEMORY_MODE_REQUIRED');
      return true;
    },
  );

  const requests: unknown[] = [];
  const issuedScopes: string[][] = [];
  const surface = createNimiHostRuntimeAgentMemorySurface({
    getSubjectUserId: () => 'owner-1',
    withScopes: async (scopes, operation) => {
      issuedScopes.push([...scopes]);
      return operation({ metadata: { 'x-nimi-test-protected-carrier': 'memory' } });
    },
    getRuntime: () => ({
      appId: 'nimi.avatar',
      auth: {
        async registerApp() {
          return { accepted: true };
        },
      },
      agent: {
        async getAgentCanonicalMemoryBankStatus(request, options) {
          requests.push({ method: 'get', request, options });
          return {
            status: {
              mode: AgentCanonicalMemoryBankMode.BASELINE,
              bankId: 'bank-baseline',
            },
          };
        },
        async requestAgentCanonicalMemoryBankBind(request, options) {
          requests.push({ method: 'bind', request, options });
          return {
            status: {
              mode: AgentCanonicalMemoryBankMode.STANDARD,
              bankId: 'bank-standard',
            },
          };
        },
      },
    }),
  });

  assert.equal((await surface.getCanonicalBankStatus(consumeContext)).bankId, 'bank-baseline');
  assert.equal((await surface.bindCanonicalBankStandard(consumeContext)).mode, 'standard');
  assert.deepEqual(requests.map((entry) => (entry as { method: string }).method), ['get', 'bind']);
  assert.deepEqual(issuedScopes, [['runtime.agent.read'], ['runtime.agent.write']]);
  assert.equal((requests[0] as { options?: { metadata?: Record<string, string> } }).options?.metadata?.['x-nimi-test-protected-carrier'], 'memory');
  assert.equal((requests[0] as { request: { context?: { appId?: string; subjectUserId?: string } } }).request.context?.appId, 'nimi.avatar');
  assert.equal((requests[0] as { request: { context?: { appId?: string; subjectUserId?: string } } }).request.context?.subjectUserId, 'owner-1');

  await assert.rejects(
    () => createNimiHostRuntimeAgentMemorySurface({
      getSubjectUserId: () => '',
      getRuntime: () => ({
        appId: 'nimi.avatar',
        auth: {
          async registerApp() {
            throw new Error('unexpected');
          },
        },
        agent: {
          async getAgentCanonicalMemoryBankStatus() {
            throw new Error('unexpected');
          },
          async requestAgentCanonicalMemoryBankBind() {
            throw new Error('unexpected');
          },
        },
      }),
    }).getCanonicalBankStatus(consumeContext),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_SUBJECT_REQUIRED');
      return true;
    },
  );
  await assert.rejects(
    () => surface.getCanonicalBankStatus({ ...consumeContext, localAgentRef: '' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_ID_REQUIRED');
      return true;
    },
  );
});


test('Runtime Agent delegated control scopes snapshot, approval, and replay projections', async () => {
  const delegatedIdentity = {
    ownerUserId: consumeContext.ownerUserId,
    runtimeSourceRef: consumeContext.runtimeSourceRef,
    localAgentRef: consumeContext.localAgentRef,
    scopedBinding: {
      bindingId: 'binding-delegation-1',
      bindingHandle: 'binding:binding-delegation-1',
      runtimeAppId: 'nimi.avatar',
      appInstanceId: 'nimi.avatar.local-first-party',
      windowId: 'window-1',
      avatarInstanceId: '',
      worldId: '',
      agentId: consumeContext.localAgentRef,
      conversationAnchorId: 'anchor-1',
    },
  };
  const calls: Array<{
    readonly scopes?: readonly string[];
    readonly method?: string;
    readonly request?: unknown;
    readonly options?: unknown;
  }> = [];
  const surface = createNimiHostRuntimeAgentDelegatedControlSurface({
    getSubjectUserId: () => 'owner-1',
    withScopes: async (scopes, operation) => {
      calls.push({ scopes });
      return operation({ metadata: { scoped: scopes.join(',') } });
    },
    getRuntime: () => ({
      appId: 'nimi.avatar',
      auth: {
        async registerApp() {
          throw new Error('withScopes should provide call options');
        },
      },
      agent: {
        async getDelegatedControlSurfaceSnapshot(request, options) {
          calls.push({ method: 'snapshot', request, options });
          return { snapshot: { approvalRequests: [], diagnostics: [] } };
        },
        async submitDelegatedApprovalDecision(request, options) {
          calls.push({ method: 'approval', request, options });
          return { approvalRequest: undefined };
        },
        async getDelegatedReplayTrace(request, options) {
          calls.push({ method: 'replay', request, options });
          return { trace: { replayId: 'replay-1' } };
        },
      },
    }),
  });

  assert.deepEqual(await surface.loadSnapshot({
    ...delegatedIdentity,
    conversationAnchorId: 'anchor-1',
  }), { approvalRequests: [], diagnostics: [] });
  assert.equal((await surface.submitApprovalDecision({
    ...delegatedIdentity,
    approvalRequestId: 'approval-1',
    decision: 'approve',
    decisionReason: 'approved by user',
  })).approvalRequest, undefined);
  assert.deepEqual(await surface.loadReplayTrace({
    ...delegatedIdentity,
    decisionId: 'decision-1',
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
  }), { replayId: 'replay-1' });

  assert.deepEqual(calls.filter((call) => call.scopes).map((call) => call.scopes), [
    ['runtime.agent.delegation.read'],
    ['runtime.agent.delegation.write'],
    ['runtime.agent.delegation.read'],
  ]);
  const approvalCall = calls.find((call) => call.method === 'approval') as {
    readonly request?: { readonly decision?: number };
  };
  assert.equal(approvalCall.request?.decision, DelegatedApprovalDecision.APPROVED_ONCE);
  const snapshotCall = calls.find((call) => call.method === 'snapshot') as {
    readonly request?: { readonly context?: { readonly scopedBinding?: unknown } };
  };
  assert.deepEqual(snapshotCall.request?.context?.scopedBinding, delegatedIdentity.scopedBinding);
});
