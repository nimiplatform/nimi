import assert from 'node:assert/strict';
import test from 'node:test';

import {
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

test('Runtime Agent delegated control scopes snapshot, approval, and replay projections', async () => {
  const delegatedIdentity = {
    ownerUserId: consumeContext.ownerUserId,
    runtimeSourceRef: consumeContext.runtimeSourceRef,
    localAgentRef: consumeContext.localAgentRef,
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
      auth: {},
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
    readonly request?: { readonly context?: Record<string, unknown> };
  };
  assert.equal('scopedBinding' in (snapshotCall.request?.context ?? {}), false);
});
