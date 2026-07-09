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
  DelegatedProviderKind,
  DelegatedProviderState,
  DelegatedProviderTrustTier,
  DelegatedTransportKind,
  EffectClass,
  HookAdmissionState,
  NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
  SensitivityClass,
  asyncEvents,
  buildNimiRuntimeAgentConsumeContext,
  buildNimiRuntimeAgentDelegatedProviderProfileFromDraft,
  buildNimiRuntimeAgentResolvedOutputText,
  buildNimiRuntimeAgentSnapshotRecoveryEvents,
  cloneNimiRuntimeAgentResolvedMessageActionEnvelopeWithCommittedMessage,
  collectAsyncIterable,
  consumeContext,
  createNimiHostRuntimeAgentDelegatedCapabilitySurface,
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
  toNimiRuntimeProtoStruct,
  type AppMessageEvent,
  type NimiRuntimeAgentConsumeEvent,
  type NimiRuntimeAgentConsumeRuntime,
  type NimiRuntimeAgentSessionTurnSnapshot,
} from './runtime-agent-consume.test-helper';

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
              agentId: 'local-agent:test-owner-1-agent-1',
              subjectUserId: 'owner-1',
              status: 1,
              lastTurnId: '',
              lastMessageId: '',
              localAgentRef: 'local-agent:test-owner-1-agent-1',
              ownerUserId: 'owner-1',
              runtimeSourceRef: 'agent-1',
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
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:test-owner-1-agent-1',
    },
    subjectUserId: 'owner-1',
    localAgentRef: 'local-agent:test-owner-1-agent-1',
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'agent-1',
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
              agentId: 'local-agent:test-owner-1-agent-1',
              subjectUserId: 'owner-1',
              status: ConversationAnchorStatus.ACTIVE,
              lastTurnId: 'turn-1',
              lastMessageId: 'message-1',
              localAgentRef: 'local-agent:test-owner-1-agent-1',
              ownerUserId: 'owner-1',
              runtimeSourceRef: 'agent-1',
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
          runtimeSourceRef: 'agent-1',
          localAgentRef: 'local-agent:test-owner-1-agent-1',
        },
        agentId: 'local-agent:test-owner-1-agent-1',
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
            agentId: 'local-agent:test-owner-1-agent-1',
            subjectUserId: 'subject-1',
            localAgentRef: 'local-agent:test-owner-1-agent-1',
            ownerUserId: 'owner-1',
            runtimeSourceRef: 'agent-1',
            callerAppId: 'nimi.avatar',
          },
          snapshot: {
            anchor: {
              conversationAnchorId: 'anchor-1',
              agentId: 'local-agent:test-owner-1-agent-1',
              subjectUserId: 'subject-1',
              status: 1,
              lastTurnId: '',
              lastMessageId: '',
              localAgentRef: 'local-agent:test-owner-1-agent-1',
              ownerUserId: 'owner-1',
              runtimeSourceRef: 'agent-1',
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
          runtimeSourceRef: 'agent-1',
          localAgentRef: 'local-agent:test-owner-1-agent-1',
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
          agentId: 'local-agent:test-owner-1-agent-1',
          subjectUserId: 'subject-1',
          localAgentRef: 'local-agent:test-owner-1-agent-1',
          ownerUserId: 'owner-1',
          runtimeSourceRef: 'agent-1',
          callerAppId: 'nimi.avatar',
        },
        snapshot: {
          anchor: {
            conversationAnchorId: 'anchor-1',
            agentId: 'local-agent:test-owner-1-agent-1',
            subjectUserId: 'subject-1',
            status: 1,
            lastTurnId: '',
            lastMessageId: '',
            localAgentRef: 'local-agent:test-owner-1-agent-1',
            ownerUserId: 'owner-1',
            runtimeSourceRef: 'agent-1',
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
          runtimeSourceRef: 'agent-1',
          localAgentRef: 'local-agent:test-owner-1-agent-1',
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
              agentId: 'local-agent:test-owner-1-agent-1',
              subjectUserId: 'owner-1',
              status: 1,
              lastTurnId: '',
              lastMessageId: '',
              localAgentRef: 'local-agent:test-owner-1-agent-1',
              ownerUserId: 'owner-1',
              runtimeSourceRef: 'agent-1',
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
          agentId: 'local-agent:test-owner-1-agent-1',
          surfaceKind: CompanionParticipationSurfaceKind.AVATAR_DEBUG_WORKBENCH,
          profileRef: 'runtime.agent.profile/local-agent:test-owner-1-agent-1',
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
    profileRef: 'runtime.agent.profile/local-agent:test-owner-1-agent-1',
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
          runtimeSourceRef: 'agent-1',
          localAgentRef: 'local-agent:test-owner-1-agent-1',
        },
        agentId: 'local-agent:test-owner-1-agent-1',
        conversationAnchorId: 'anchor-1',
        surfaceKind: CompanionParticipationSurfaceKind.AVATAR_DEBUG_WORKBENCH,
        triggerSource: CompanionParticipationTriggerSource.USER_EXPLICIT,
        profileRef: 'runtime.agent.profile/local-agent:test-owner-1-agent-1',
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
          agentId: 'local-agent:test-owner-1-agent-1',
          surfaceKind: CompanionParticipationSurfaceKind.AVATAR_DEBUG_WORKBENCH,
          profileRef: 'runtime.agent.profile/local-agent:test-owner-1-agent-1',
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
          runtimeSourceRef: 'agent-1',
          localAgentRef: 'local-agent:test-owner-1-agent-1',
        },
        agentId: 'local-agent:test-owner-1-agent-1',
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
