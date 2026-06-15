import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
  buildNimiRuntimeAgentConsumeContext,
  buildNimiRuntimeAgentDelegatedProviderProfileFromDraft,
  buildNimiRuntimeAgentResolvedOutputText,
  buildNimiRuntimeAgentSnapshotRecoveryEvents,
  cloneNimiRuntimeAgentResolvedMessageActionEnvelopeWithCommittedMessage,
  createNimiHostRuntimeAgentDelegatedCapabilitySurface,
  createNimiHostRuntimeAgentMemorySurface,
  createNimiRuntimeAgentConsumeClient,
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
  toNimiRuntimeProtoStruct,
  type AppMessageEvent,
  type NimiRuntimeAgentConsumeEvent,
  type NimiRuntimeAgentConsumeRuntime,
  type NimiRuntimeAgentSessionTurnSnapshot,
} from './index';
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
  DelegatedProviderKind,
  DelegatedProviderState,
  DelegatedProviderTrustTier,
  DelegatedTransportKind,
  EffectClass,
  HookAdmissionState,
  SensitivityClass,
} from '../core-generated/runtime-typed-client';

const consumeContext = {
  runtimeAppId: 'nimi.avatar',
  ownerUserId: 'owner-1',
  realmAgentId: 'agent-1',
  localAgentRef: 'local-agent:owner-1:agent-1',
};

function createUnexpectedRuntimeAgentConsumeRuntime(
  overrides: Partial<NimiRuntimeAgentConsumeRuntime['agents']>,
): NimiRuntimeAgentConsumeRuntime {
  return {
    agents: {
      async openConversationAnchor() {
        throw new Error('unexpected');
      },
      async getConversationAnchorSnapshot() {
        throw new Error('unexpected');
      },
      async registerAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async resolveAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async getPublicChatSessionSnapshot() {
        throw new Error('unexpected');
      },
      subscribeAgentEvents() {
        throw new Error('unexpected');
      },
      async requestCompanionParticipation() {
        throw new Error('unexpected');
      },
      async cancelCompanionParticipation() {
        throw new Error('unexpected');
      },
      ...overrides,
    },
  };
}

async function* asyncEvents<T>(events: readonly T[]): AsyncIterable<T> {
  for (const event of events) {
    yield event;
  }
}

async function collectAsyncIterable<T>(source: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of source) {
    collected.push(event);
  }
  return collected;
}

test('Runtime Agent message-action helpers parse structured envelopes and fail closed', () => {
  const envelope = parseNimiRuntimeAgentStructuredMessageActionEnvelope({
    message: {
      message_id: 'assistant-1',
      text: 'Paint the gate and speak the cue.',
    },
    status_cue: {
      source_message_id: 'assistant-1',
      mood: 'joy',
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
  assert.equal(envelope.statusCue?.mood, 'joy');
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
      statusCue: { sourceMessageId: 'assistant-1', mood: 'angry' },
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
  const surface = createNimiHostRuntimeAgentMemorySurface({
    getSubjectUserId: () => 'owner-1',
    getRuntime: () => ({
      appId: 'nimi.avatar',
      auth: {
        async registerApp() {
          return { accepted: true };
        },
      },
      appAuth: {
        async authorizeExternalPrincipal() {
          return { tokenId: 'token-1', secret: 'secret-1' };
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

  assert.equal((await surface.getCanonicalBankStatus('local-agent:owner-1:agent-1')).bankId, 'bank-baseline');
  assert.equal((await surface.bindCanonicalBankStandard('local-agent:owner-1:agent-1')).mode, 'standard');
  assert.deepEqual(requests.map((entry) => (entry as { method: string }).method), ['get', 'bind']);
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
        appAuth: {
          async authorizeExternalPrincipal() {
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
    }).getCanonicalBankStatus('local-agent:owner-1:agent-1'),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_SUBJECT_REQUIRED');
      return true;
    },
  );
  await assert.rejects(
    () => surface.getCanonicalBankStatus(''),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_ID_REQUIRED');
      return true;
    },
  );
});

test('Runtime Agent delegated helpers build scoped provider, approval, and replay envelopes', async () => {
  assert.deepEqual(buildNimiRuntimeAgentDelegatedProviderProfileFromDraft({
    agentId: 'local-agent:owner-1:agent-1',
    providerProfileId: 'provider-1',
    displayName: '',
    transportRef: 'stdio:provider-1',
    credentialRef: 'credential-1',
    command: 'node',
    args: 'server.js --stdio',
    toolName: 'search',
    inputSchemaDigest: 'sha256:abc',
    effectClass: EffectClass.READ_ONLY,
    expectedSensitivityClass: SensitivityClass.NONE,
  }), {
    providerProfileId: 'provider-1',
    displayName: 'provider-1',
    providerKind: DelegatedProviderKind.MCP_TOOL_PROVIDER,
    transportKind: DelegatedTransportKind.STDIO_COMMAND,
    state: DelegatedProviderState.READY,
    allowedTools: [{
      toolName: 'search',
      inputSchemaDigest: 'sha256:abc',
      effectClass: EffectClass.READ_ONLY,
      expectedSensitivityClass: SensitivityClass.NONE,
    }],
    credentialRef: 'credential-1',
    transportRef: 'stdio:provider-1',
    trustTier: DelegatedProviderTrustTier.USER_ADDED_REVIEWED,
    lifecycleReasonCode: '',
    command: 'node',
    args: ['server.js', '--stdio'],
  });
  assert.throws(
    () => buildNimiRuntimeAgentDelegatedProviderProfileFromDraft({
      agentId: 'local-agent:owner-1:agent-1',
      providerProfileId: 'provider-1',
      displayName: '',
      transportRef: 'stdio:provider-1',
      credentialRef: '',
      command: '',
      args: '',
      toolName: 'search',
      inputSchemaDigest: '',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_DELEGATED_INPUT_INVALID');
      return true;
    },
  );

  const calls: Array<{ readonly scopes?: readonly string[]; readonly method?: string; readonly request?: unknown; readonly options?: unknown }> = [];
  const surface = createNimiHostRuntimeAgentDelegatedCapabilitySurface({
    disabledProviderReasonCode: 'disabled_for_test',
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
      appAuth: {
        async authorizeExternalPrincipal() {
          throw new Error('withScopes should provide call options');
        },
      },
      agent: {
        async executeDelegatedCapability(request, options) {
          calls.push({ method: 'execute', request, options });
          return { modelOutput: toNimiRuntimeProtoStruct({ text: 'runtime-owned result' }) };
        },
        async resumeDelegatedCapability(request, options) {
          calls.push({ method: 'resume', request, options });
          return { modelOutput: toNimiRuntimeProtoStruct({ text: 'resumed result' }) };
        },
        async getDelegatedControlSurfaceSnapshot(request, options) {
          calls.push({ method: 'snapshot', request, options });
          return { snapshot: { providerProfiles: [] } };
        },
        async upsertDelegatedProviderProfile(request, options) {
          calls.push({ method: 'upsert', request, options });
          return { providerProfile: request.providerProfile };
        },
        async setDelegatedProviderState(request, options) {
          calls.push({ method: 'state', request, options });
          return {
            providerProfile: {
              providerProfileId: request.providerProfileId,
              state: request.state,
              lifecycleReasonCode: request.lifecycleReasonCode,
            },
          };
        },
        async submitDelegatedApprovalDecision(request, options) {
          calls.push({ method: 'approval', request, options });
          return { approvalRequest: undefined };
        },
        async getDelegatedReplayTrace(request, options) {
          calls.push({ method: 'replay', request, options });
          return { trace: { decisionId: request.decisionId } };
        },
      },
    }),
  });

  assert.deepEqual(await surface.loadSnapshot({
    agentId: 'local-agent:owner-1:agent-1',
    conversationAnchorId: 'anchor-1',
  }), { providerProfiles: [] });
  assert.equal((await surface.upsertProviderProfile({
    agentId: 'local-agent:owner-1:agent-1',
    providerProfileId: 'provider-1',
    displayName: 'Provider One',
    transportRef: 'stdio:provider-1',
    credentialRef: 'credential-1',
    command: 'node',
    args: 'server.js --stdio',
    toolName: 'search',
    inputSchemaDigest: 'sha256:abc',
  }))?.displayName, 'Provider One');
  assert.equal((await surface.setProviderEnabled('local-agent:owner-1:agent-1', 'provider-1', false))?.state, DelegatedProviderState.DISABLED);
  assert.equal((await surface.submitApprovalDecision(
    'local-agent:owner-1:agent-1',
    'approval-1',
    'approve',
    'approved by user',
  )).approvalRequest, undefined);
  assert.deepEqual((await surface.executeCapability({
    agentId: 'local-agent:owner-1:agent-1',
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    streamId: 'stream-1',
    requestId: 'request-1',
    providerProfileId: 'provider-1',
    capabilityId: 'calendar.lookup',
    toolName: 'search',
    arguments: { query: 'hello' },
    descriptorHash: 'sha256:abc',
    protocolRevision: 'v1',
    outputKind: 'observation',
    requiresApproval: true,
  })).output, { text: 'runtime-owned result' });
  assert.deepEqual((await surface.resumeApprovedCapability(
    'local-agent:owner-1:agent-1',
    'approval-1',
  )).output, { text: 'resumed result' });
  assert.deepEqual(await surface.loadReplayTrace(
    'local-agent:owner-1:agent-1',
    'decision-1',
    'anchor-1',
    'turn-1',
  ), { decisionId: 'decision-1' });

  assert.deepEqual(calls.filter((call) => call.scopes).map((call) => call.scopes), [
    ['runtime.agent.delegation.read'],
    ['runtime.agent.delegation.write'],
    ['runtime.agent.delegation.write'],
    ['runtime.agent.delegation.write'],
    ['runtime.agent.delegation.write'],
    ['runtime.agent.delegation.write'],
    ['runtime.agent.delegation.read'],
  ]);
  const stateCall = calls.find((call) => call.method === 'state') as { readonly request?: { readonly state?: number; readonly lifecycleReasonCode?: string } };
  assert.equal(stateCall.request?.state, DelegatedProviderState.DISABLED);
  assert.equal(stateCall.request?.lifecycleReasonCode, 'disabled_for_test');
  const approvalCall = calls.find((call) => call.method === 'approval') as { readonly request?: { readonly decision?: number; readonly decisionReason?: string } };
  assert.equal(approvalCall.request?.decision, DelegatedApprovalDecision.APPROVED_ONCE);
  assert.equal(approvalCall.request?.decisionReason, 'approved by user');
  const executeCall = calls.find((call) => call.method === 'execute') as {
    readonly request?: {
      readonly conversationAnchorId?: string;
      readonly turnId?: string;
      readonly providerProfileId?: string;
      readonly capabilityId?: string;
      readonly toolName?: string;
      readonly arguments?: unknown;
      readonly descriptorHash?: string;
      readonly requiresApproval?: boolean;
    };
  };
  assert.equal(executeCall.request?.conversationAnchorId, 'anchor-1');
  assert.equal(executeCall.request?.turnId, 'turn-1');
  assert.equal(executeCall.request?.providerProfileId, 'provider-1');
  assert.equal(executeCall.request?.capabilityId, 'calendar.lookup');
  assert.equal(executeCall.request?.toolName, 'search');
  assert.deepEqual(executeCall.request?.arguments, toNimiRuntimeProtoStruct({ query: 'hello' }));
  assert.equal(executeCall.request?.descriptorHash, 'sha256:abc');
  assert.equal(executeCall.request?.requiresApproval, true);
  const resumeCall = calls.find((call) => call.method === 'resume') as { readonly request?: { readonly approvalRequestId?: string } };
  assert.equal(resumeCall.request?.approvalRequestId, 'approval-1');
  const replayCall = calls.find((call) => call.method === 'replay') as { readonly request?: { readonly conversationAnchorId?: string; readonly turnId?: string } };
  assert.equal(replayCall.request?.conversationAnchorId, 'anchor-1');
  assert.equal(replayCall.request?.turnId, 'turn-1');
});

test('Runtime Agent consume client builds canonical Runtime Agent requests', async () => {
  const requests: unknown[] = [];
  const runtime: NimiRuntimeAgentConsumeRuntime = {
    agents: {
      async openConversationAnchor(request) {
        requests.push(request);
        return {
          snapshot: {
            anchor: {
              conversationAnchorId: 'anchor-1',
              agentId: 'local-agent:owner-1:agent-1',
              subjectUserId: 'owner-1',
              status: 1,
              lastTurnId: '',
              lastMessageId: '',
              localAgentRef: 'local-agent:owner-1:agent-1',
              ownerUserId: 'owner-1',
              realmAgentId: 'agent-1',
            },
            activeTurnId: '',
            activeStreamId: '',
          },
        };
      },
      async getConversationAnchorSnapshot() {
        throw new Error('unexpected');
      },
      async registerAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async resolveAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async getPublicChatSessionSnapshot() {
        throw new Error('unexpected');
      },
      subscribeAgentEvents() {
        throw new Error('unexpected');
      },
      async requestCompanionParticipation() {
        throw new Error('unexpected');
      },
      async cancelCompanionParticipation() {
        throw new Error('unexpected');
      },
    },
  };

  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  const snapshot = await client.anchors.open(consumeContext);

  assert.equal(snapshot.anchor?.conversationAnchorId, 'anchor-1');
  assert.deepEqual(requests[0], {
    context: {
      appId: 'nimi.avatar',
      subjectUserId: 'owner-1',
      ownerUserId: 'owner-1',
      realmAgentId: 'agent-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
    },
    subjectUserId: 'owner-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
  });
});

test('Runtime Agent consume client lists conversation summaries through Runtime Agent', async () => {
  const calls: {
    request: unknown;
    options?: unknown;
  }[] = [];
  const callOptions = { timeoutMs: 2000 };
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async listAgentConversationSummaries(request, options) {
      calls.push({ request, options });
      return {
        summaries: [
          {
            anchor: {
              conversationAnchorId: 'anchor-1',
              agentId: 'local-agent:owner-1:agent-1',
              subjectUserId: 'owner-1',
              status: ConversationAnchorStatus.ACTIVE,
              lastTurnId: 'turn-1',
              lastMessageId: 'message-1',
              localAgentRef: 'local-agent:owner-1:agent-1',
              ownerUserId: 'owner-1',
              realmAgentId: 'agent-1',
            },
            title: 'Runtime title',
            lastMessageRole: 'assistant',
            lastMessageText: 'hello',
            lastMessageId: 'message-1',
            transcriptMessageCount: 2,
          },
        ],
        nextPageToken: 'cursor-2',
      };
    },
  });

  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  const result = await client.anchors.listSummaries({
    ...consumeContext,
    statusFilter: ['active'],
    pageSize: 1,
    pageToken: 'cursor-1',
  }, callOptions);

  assert.equal(result.summaries.length, 1);
  assert.equal(result.nextPageToken, 'cursor-2');
  assert.deepEqual(calls, [
    {
      request: {
        context: {
          appId: 'nimi.avatar',
          subjectUserId: 'owner-1',
          ownerUserId: 'owner-1',
          realmAgentId: 'agent-1',
          localAgentRef: 'local-agent:owner-1:agent-1',
        },
        agentId: 'local-agent:owner-1:agent-1',
        statusFilter: [ConversationAnchorStatus.ACTIVE],
        pageSize: 1,
        pageToken: 'cursor-1',
      },
      options: callOptions,
    },
  ]);
});

test('Runtime Agent consume client fails closed on invalid conversation summary inputs and responses', async () => {
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async listAgentConversationSummaries() {
      return {};
    },
  });
  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });

  await assert.rejects(
    () => client.anchors.listSummaries({
      ...consumeContext,
      statusFilter: ['archived' as 'active'],
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_INPUT_INVALID');
      return true;
    },
  );
  await assert.rejects(
    () => client.anchors.listSummaries({
      ...consumeContext,
      pageSize: -1,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_INPUT_INVALID');
      return true;
    },
  );
  await assert.rejects(
    () => client.anchors.listSummaries({
      ...consumeContext,
      pageToken: 1,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_INPUT_INVALID');
      return true;
    },
  );
  await assert.rejects(
    () => client.anchors.listSummaries(consumeContext),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_RESPONSE_INVALID');
      return true;
    },
  );
});

test('Runtime Agent consume client registers Avatar live instance binding through Runtime Agent', async () => {
  const calls: {
    request: unknown;
    options?: unknown;
  }[] = [];
  const callOptions = { timeoutMs: 5000 };
  const runtime: NimiRuntimeAgentConsumeRuntime = {
    agents: {
      async openConversationAnchor() {
        throw new Error('unexpected');
      },
      async getConversationAnchorSnapshot() {
        throw new Error('unexpected');
      },
      async registerAvatarLiveInstanceBinding(request, options) {
        calls.push({ request, options });
        return {
          binding: {
            avatarInstanceId: 'avatar-1',
            conversationAnchorId: 'anchor-1',
            agentId: 'local-agent:owner-1:agent-1',
            subjectUserId: 'subject-1',
            localAgentRef: 'local-agent:owner-1:agent-1',
            ownerUserId: 'owner-1',
            realmAgentId: 'agent-1',
            callerAppId: 'nimi.avatar',
          },
          snapshot: {
            anchor: {
              conversationAnchorId: 'anchor-1',
              agentId: 'local-agent:owner-1:agent-1',
              subjectUserId: 'subject-1',
              status: 1,
              lastTurnId: '',
              lastMessageId: '',
              localAgentRef: 'local-agent:owner-1:agent-1',
              ownerUserId: 'owner-1',
              realmAgentId: 'agent-1',
            },
            activeTurnId: '',
            activeStreamId: '',
          },
        };
      },
      async resolveAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async getPublicChatSessionSnapshot() {
        throw new Error('unexpected');
      },
      subscribeAgentEvents() {
        throw new Error('unexpected');
      },
      async requestCompanionParticipation() {
        throw new Error('unexpected');
      },
      async cancelCompanionParticipation() {
        throw new Error('unexpected');
      },
    },
  };

  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  const result = await client.anchors.registerAvatarLiveInstance({
    ...consumeContext,
    subjectUserId: 'subject-1',
    avatarInstanceId: 'avatar-1',
    conversationAnchorId: 'anchor-1',
  }, callOptions);

  assert.equal(result.binding.avatarInstanceId, 'avatar-1');
  assert.equal(result.snapshot.anchor?.conversationAnchorId, 'anchor-1');
  assert.deepEqual(calls, [
    {
      request: {
        context: {
          appId: 'nimi.avatar',
          subjectUserId: 'subject-1',
          ownerUserId: 'owner-1',
          realmAgentId: 'agent-1',
          localAgentRef: 'local-agent:owner-1:agent-1',
        },
        avatarInstanceId: 'avatar-1',
        conversationAnchorId: 'anchor-1',
      },
      options: callOptions,
    },
  ]);
});

test('Runtime Agent consume client resolves Avatar live instance binding through Runtime Agent', async () => {
  const calls: { request: unknown; options?: unknown }[] = [];
  const callOptions = { timeoutMs: 5000 };
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async resolveAvatarLiveInstanceBinding(request, options) {
      calls.push({ request, options });
      return {
        binding: {
          avatarInstanceId: 'avatar-1',
          conversationAnchorId: 'anchor-1',
          agentId: 'local-agent:owner-1:agent-1',
          subjectUserId: 'subject-1',
          localAgentRef: 'local-agent:owner-1:agent-1',
          ownerUserId: 'owner-1',
          realmAgentId: 'agent-1',
          callerAppId: 'nimi.avatar',
        },
        snapshot: {
          anchor: {
            conversationAnchorId: 'anchor-1',
            agentId: 'local-agent:owner-1:agent-1',
            subjectUserId: 'subject-1',
            status: 1,
            lastTurnId: '',
            lastMessageId: '',
            localAgentRef: 'local-agent:owner-1:agent-1',
            ownerUserId: 'owner-1',
            realmAgentId: 'agent-1',
          },
          activeTurnId: '',
          activeStreamId: '',
        },
      };
    },
  });

  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  const result = await client.anchors.resolveAvatarLiveInstance({
    ...consumeContext,
    subjectUserId: 'subject-1',
    avatarInstanceId: 'avatar-1',
  }, callOptions);

  assert.equal(result.binding.avatarInstanceId, 'avatar-1');
  assert.equal(result.snapshot.anchor?.conversationAnchorId, 'anchor-1');
  assert.deepEqual(calls, [
    {
      request: {
        context: {
          appId: 'nimi.avatar',
          subjectUserId: 'subject-1',
          ownerUserId: 'owner-1',
          realmAgentId: 'agent-1',
          localAgentRef: 'local-agent:owner-1:agent-1',
        },
        avatarInstanceId: 'avatar-1',
      },
      options: callOptions,
    },
  ]);
});

test('Runtime Agent consume client fails closed when Avatar binding projection is missing', async () => {
  const runtime: NimiRuntimeAgentConsumeRuntime = {
    agents: {
      async openConversationAnchor() {
        throw new Error('unexpected');
      },
      async getConversationAnchorSnapshot() {
        throw new Error('unexpected');
      },
      async registerAvatarLiveInstanceBinding() {
        return {
          snapshot: {
            anchor: {
              conversationAnchorId: 'anchor-1',
              agentId: 'local-agent:owner-1:agent-1',
              subjectUserId: 'owner-1',
              status: 1,
              lastTurnId: '',
              lastMessageId: '',
              localAgentRef: 'local-agent:owner-1:agent-1',
              ownerUserId: 'owner-1',
              realmAgentId: 'agent-1',
            },
            activeTurnId: '',
            activeStreamId: '',
          },
        };
      },
      async resolveAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async getPublicChatSessionSnapshot() {
        throw new Error('unexpected');
      },
      subscribeAgentEvents() {
        throw new Error('unexpected');
      },
      async requestCompanionParticipation() {
        throw new Error('unexpected');
      },
      async cancelCompanionParticipation() {
        throw new Error('unexpected');
      },
    },
  };
  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });

  await assert.rejects(
    () => client.anchors.registerAvatarLiveInstance({
      ...consumeContext,
      avatarInstanceId: 'avatar-1',
      conversationAnchorId: 'anchor-1',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_RESPONSE_INVALID');
      return true;
    },
  );
});

test('Runtime Agent consume client decodes companion participation projection and builds getProjection request', async () => {
  const calls: {
    request: unknown;
    options?: unknown;
  }[] = [];
  const callOptions = { timeoutMs: 7000 };
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async getCompanionParticipationProjection(request, options) {
      calls.push({ request, options });
      return {
        projection: {
          projectionId: 'projection-1',
          agentId: 'local-agent:owner-1:agent-1',
          surfaceKind: CompanionParticipationSurfaceKind.AVATAR_DEBUG_WORKBENCH,
          profileRef: 'runtime.agent.profile/local-agent:owner-1:agent-1',
          roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
          triggerSource: CompanionParticipationTriggerSource.USER_EXPLICIT,
          status: CompanionParticipationStatus.BLOCKED,
          candidateRef: '',
          commitRef: '',
          refusalReason: 'runtime_policy_blocked',
          presentationRef: '',
          auditRef: 'runtime.audit.companion_participation/projection-1',
          conversationAnchorId: 'anchor-1',
          turnId: '',
          streamId: '',
        },
      };
    },
  });

  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  const projection = await client.companionParticipation.getProjection({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
    surfaceKind: 'avatar_debug_workbench',
    triggerSource: 'user_explicit',
    profileRef: 'runtime.agent.profile/local-agent:owner-1:agent-1',
    roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
    requestId: 'request-1',
  }, callOptions);

  assert.equal(projection.surfaceKind, 'avatar_debug_workbench');
  assert.equal(projection.triggerSource, 'user_explicit');
  assert.equal(projection.status, 'blocked');
  assert.equal(projection.refusalReason, 'runtime_policy_blocked');
  assert.deepEqual(calls, [
    {
      request: {
        context: {
          appId: 'nimi.avatar',
          subjectUserId: 'owner-1',
          ownerUserId: 'owner-1',
          realmAgentId: 'agent-1',
          localAgentRef: 'local-agent:owner-1:agent-1',
        },
        agentId: 'local-agent:owner-1:agent-1',
        conversationAnchorId: 'anchor-1',
        surfaceKind: CompanionParticipationSurfaceKind.AVATAR_DEBUG_WORKBENCH,
        triggerSource: CompanionParticipationTriggerSource.USER_EXPLICIT,
        profileRef: 'runtime.agent.profile/local-agent:owner-1:agent-1',
        roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
        requestId: 'request-1',
      },
      options: callOptions,
    },
  ]);
});

test('Runtime Agent consume client fails closed on invalid companion participation projections', async () => {
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async getCompanionParticipationProjection() {
      return {
        projection: {
          projectionId: 'projection-1',
          agentId: 'local-agent:owner-1:agent-1',
          surfaceKind: CompanionParticipationSurfaceKind.AVATAR_DEBUG_WORKBENCH,
          profileRef: 'runtime.agent.profile/local-agent:owner-1:agent-1',
          roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
          triggerSource: CompanionParticipationTriggerSource.USER_EXPLICIT,
          status: 999 as CompanionParticipationStatus,
          candidateRef: '',
          commitRef: '',
          refusalReason: '',
          presentationRef: '',
          auditRef: 'runtime.audit.companion_participation/projection-1',
          conversationAnchorId: 'anchor-1',
          turnId: '',
          streamId: '',
        },
      };
    },
  });
  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });

  await assert.rejects(
    () => client.companionParticipation.getProjection({
      ...consumeContext,
      conversationAnchorId: 'anchor-1',
      surfaceKind: 'avatar_debug_workbench',
      triggerSource: 'user_explicit',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_RESPONSE_INVALID');
      return true;
    },
  );
});

test('Runtime Agent consume client builds avatar debug probe requests through Runtime Agent', async () => {
  const calls: {
    request: unknown;
    options?: unknown;
  }[] = [];
  const callOptions = { timeoutMs: 3000 };
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async requestAvatarDebugProbe(request, options) {
      calls.push({ request, options });
      return {};
    },
  });

  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  await client.avatarDebug.requestProbe({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
    probeKind: AvatarDebugProbeKind.GENERATED_MOTION,
    requestedBy: AvatarDebugRequestedBy.DESKTOP_DEBUG_WORKBENCH,
    probeId: 'probe-1',
    turnId: 'turn-1',
    streamId: 'stream-1',
    avatarInstanceId: 'avatar-1',
    replayRequested: true,
  }, callOptions);

  assert.deepEqual(calls, [
    {
      request: {
        context: {
          appId: 'nimi.avatar',
          subjectUserId: 'owner-1',
          ownerUserId: 'owner-1',
          realmAgentId: 'agent-1',
          localAgentRef: 'local-agent:owner-1:agent-1',
        },
        agentId: 'local-agent:owner-1:agent-1',
        conversationAnchorId: 'anchor-1',
        probeKind: AvatarDebugProbeKind.GENERATED_MOTION,
        requestedBy: AvatarDebugRequestedBy.DESKTOP_DEBUG_WORKBENCH,
        probeId: 'probe-1',
        turnId: 'turn-1',
        streamId: 'stream-1',
        avatarInstanceId: 'avatar-1',
        replayRequested: true,
      },
      options: callOptions,
    },
  ]);
});

test('Runtime Agent consume client rejects unsupported avatar debug enums', async () => {
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async requestAvatarDebugProbe() {
      throw new Error('unexpected');
    },
  });
  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });

  await assert.rejects(
    () => client.avatarDebug.requestProbe({
      ...consumeContext,
      conversationAnchorId: 'anchor-1',
      probeKind: 999 as AvatarDebugProbeKind,
      requestedBy: AvatarDebugRequestedBy.DESKTOP_DEBUG_WORKBENCH,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_INPUT_INVALID');
      return true;
    },
  );
  await assert.rejects(
    () => client.avatarDebug.requestProbe({
      ...consumeContext,
      conversationAnchorId: 'anchor-1',
      probeKind: AvatarDebugProbeKind.GENERATED_MOTION,
      requestedBy: AvatarDebugRequestedBy.UNSPECIFIED,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_INPUT_INVALID');
      return true;
    },
  );
});

test('Runtime Agent consume client parses public chat session snapshots', async () => {
  const runtime: NimiRuntimeAgentConsumeRuntime = {
    agents: {
      async openConversationAnchor() {
        throw new Error('unexpected');
      },
      async getConversationAnchorSnapshot() {
        throw new Error('unexpected');
      },
      async registerAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async resolveAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async getPublicChatSessionSnapshot() {
        return {
          snapshot: toNimiRuntimeProtoStruct({
            session_status: 'ready',
            transcript_message_count: 2,
            transcript: [
              {
                id: 'message-user-1',
                role: 'user',
                content: 'hello',
                status: 'complete',
                kind: 'text',
                created_at: '2026-06-05T00:00:00.000Z',
                updated_at: '2026-06-05T00:00:00.000Z',
              },
              {
                id: 'message-assistant-1',
                role: 'assistant',
                content: 'hi',
                status: 'complete',
                kind: 'text',
                created_at: '2026-06-05T00:00:01.000Z',
                updated_at: '2026-06-05T00:00:01.000Z',
                parent_message_id: 'message-user-1',
                reasoning_text: '',
              },
            ],
            active_turn: {
              turn_id: 'turn-2',
              stream_id: 'stream-2',
              text: 'streaming',
            },
            last_turn: {
              turn_id: 'turn-1',
              stream_id: 'stream-1',
              message_id: 'message-1',
              text: 'hello',
              structured: {
                status_cue: {
                  mood: 'joy',
                },
              },
            },
          }),
        };
      },
      subscribeAgentEvents() {
        throw new Error('unexpected');
      },
      async requestCompanionParticipation() {
        throw new Error('unexpected');
      },
      async cancelCompanionParticipation() {
        throw new Error('unexpected');
      },
    },
  };

  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  const snapshot = await client.turns.getSessionSnapshot({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
  });

  assert.equal(snapshot.sessionStatus, 'ready');
  assert.equal(snapshot.transcriptMessageCount, 2);
  assert.equal(snapshot.transcript?.length, 2);
  assert.equal(snapshot.transcript?.[0]?.id, 'message-user-1');
  assert.equal(snapshot.transcript?.[1]?.parentMessageId, 'message-user-1');
  assert.equal(snapshot.activeTurn?.turnId, 'turn-2');
  assert.equal(snapshot.lastTurn?.messageId, 'message-1');
  assert.deepEqual(snapshot.lastTurn?.structured, {
    status_cue: {
      mood: 'joy',
    },
  });
});

test('Runtime Agent consume client omits malformed transcript replay envelopes', async () => {
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async getPublicChatSessionSnapshot() {
      return {
        snapshot: toNimiRuntimeProtoStruct({
          session_status: 'ready',
          transcript_message_count: 1,
          transcript: [
            {
              role: 'assistant',
              content: 'missing replay id',
              status: 'complete',
              kind: 'text',
              created_at: '2026-06-05T00:00:00.000Z',
              updated_at: '2026-06-05T00:00:00.000Z',
            },
          ],
        }),
      };
    },
  });
  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  const snapshot = await client.turns.getSessionSnapshot({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
  });

  assert.equal(snapshot.sessionStatus, 'ready');
  assert.equal(snapshot.transcriptMessageCount, 1);
  assert.equal(snapshot.transcript, undefined);
});

test('Runtime Agent consume parses turn app messages and validates timelines', () => {
  const payload = {
    local_agent_ref: 'local-agent:owner-1:agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    text: 'hi',
    runtime_timeline: {
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      channel: 'text',
      offset_ms: 12,
      sequence: 1,
      started_at_wall: '2026-06-05T00:00:00.000Z',
      observed_at_wall: '2026-06-05T00:00:00.012Z',
      timebase_owner: 'runtime',
      projection_rule_id: 'K-AGCORE-051',
      clock_basis: 'monotonic_with_wall_anchor',
      provider_neutral: true,
      app_local_authority: false,
    },
  };
  const event: AppMessageEvent = {
    eventType: 0,
    sequence: '1',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.turn.text_delta',
    payload: toNimiRuntimeProtoStruct(payload),
  };

  const projected = projectNimiRuntimeAgentAppMessageEvent(event);

  assert.equal(projected?.eventName, 'runtime.agent.turn.text_delta');
  assert.equal(projected?.detail.text, 'hi');
  assert.equal(projected?.timeline?.projectionRuleId, 'K-AGCORE-051');
  assert.throws(
    () => parseNimiRuntimeAgentTimeline({ ...payload.runtime_timeline, channel: 'voice' }, 'runtime.agent.turn.text_delta', 'turn-1', 'stream-1'),
    /timeline channel must be text/u,
  );
});

test('Runtime Agent consume preserves structured app message payload for the turn runner', () => {
  const payload = {
    local_agent_ref: 'local-agent:owner-1:agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    structured: {
      message: {
        message_id: 'assistant-1',
        text: 'structured hello',
      },
      actions: [],
    },
  };
  const event: AppMessageEvent = {
    eventType: 0,
    sequence: '2',
    messageId: 'runtime-event-structured',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.turn.structured',
    payload: toNimiRuntimeProtoStruct(payload),
    reasonCode: 0,
    traceId: '',
  };

  const projected = projectNimiRuntimeAgentAppMessageEvent(event);

  assert.equal(projected?.eventName, 'runtime.agent.turn.structured');
  assert.equal((projected?.detail.payload as { message?: { text?: string } })?.message?.text, 'structured hello');
  assert.equal((projected?.detail.structured as { message?: { text?: string } })?.message?.text, 'structured hello');
});

test('Runtime Agent consume preserves accepted request id for backlog filtering', () => {
  const payload = {
    local_agent_ref: 'local-agent:owner-1:agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    request_id: 'request-1',
  };
  const event: AppMessageEvent = {
    eventType: 0,
    sequence: '3',
    messageId: 'runtime-event-accepted',
    fromAppId: 'runtime.agent',
    toAppId: 'nimi.avatar',
    subjectUserId: 'owner-1',
    messageType: 'runtime.agent.turn.accepted',
    payload: toNimiRuntimeProtoStruct(payload),
    reasonCode: 0,
    traceId: '',
  };

  const projected = projectNimiRuntimeAgentAppMessageEvent(event);

  assert.equal(projected?.eventName, 'runtime.agent.turn.accepted');
  assert.equal(projected?.detail.requestId, 'request-1');
});
