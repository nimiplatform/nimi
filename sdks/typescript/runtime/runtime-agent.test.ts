import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNimiRuntimeAgentStateMutations,
  createNimiHostRuntimeAgentInspectSurface,
  createNimiRuntimeAgentSmokeVerificationSurface,
  buildNimiSetRuntimeAgentPresentationProfileRequest,
  createNimiHostRuntimeAgentPresentationProfileSurface,
  projectNimiRuntimeAgentInspectSnapshot,
  readNimiRuntimeAgentPresentationProfile,
  toNimiRuntimeProtoStruct,
  toNimiRuntimeTimestamp,
} from './index';
import {
  AgentAutonomyMode,
  AgentEventType,
  AgentExecutionState,
  AgentLifecycleStatus,
  AgentPresentationBackendKind,
  HookAdmissionState,
  HookTriggerFamily,
  MemoryCanonicalClass,
  MemoryRecordKind,
  RuntimeHealthStatus,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';

test('Runtime Agent projection reads presentation metadata and state snapshots', () => {
  const metadata = toNimiRuntimeProtoStruct({
    presentationProfile: {
      backendKind: 'vrm',
      avatarAssetRef: 'avatar://agent/default',
      expressionProfileRef: 'expression://calm',
      idlePreset: 'idle',
      interactionPolicyRef: 'policy://default',
      defaultVoiceReference: 'preset_voice_id:nimi-default',
    },
  });

  const snapshot = projectNimiRuntimeAgentInspectSnapshot({
    agent: {
      lifecycleStatus: AgentLifecycleStatus.ACTIVE,
      metadata,
      autonomy: {
        enabled: true,
        config: {
          dailyTokenBudget: '1200',
          maxTokensPerHook: '80',
          mode: AgentAutonomyMode.HIGH,
        },
        usedTokensInWindow: '12',
        windowStartedAt: toNimiRuntimeTimestamp('2026-06-05T00:00:00.000Z'),
        budgetExhausted: false,
      },
    },
    state: {
      executionState: AgentExecutionState.CHAT_ACTIVE,
      statusText: 'answering',
      activeWorldId: 'world-1',
      activeUserId: 'user-2',
      attributes: {},
      currentEmotion: 'focused',
    },
    activeHooks: [{
      hookId: 'hook-1',
      status: 'pending',
      triggerKind: 'scheduled-time',
      scheduledFor: '2026-06-05T01:00:00.000Z',
      admittedAt: null,
    }],
    recentCanonicalMemories: [{
      canonicalClass: MemoryCanonicalClass.DYADIC,
      recallScore: 0.87,
      policyReason: 'active_context',
      record: {
        memoryId: 'memory-1',
        kind: MemoryRecordKind.SEMANTIC,
        canonicalClass: MemoryCanonicalClass.DYADIC,
        provenance: {
          sourceSystem: 'runtime.agent',
          sourceEventId: 'event-1',
          authorId: 'agent-1',
          traceId: 'trace-1',
        },
        payload: {
          oneofKind: 'semantic',
          semantic: {
            subject: 'MingSim',
            predicate: 'uses',
            object: 'Runtime Agent',
            confidence: 0.95,
          },
        },
      },
    }],
  });

  assert.deepEqual(readNimiRuntimeAgentPresentationProfile(metadata), {
    backendKind: 'vrm',
    avatarAssetRef: 'avatar://agent/default',
    expressionProfileRef: 'expression://calm',
    idlePreset: 'idle',
    interactionPolicyRef: 'policy://default',
    defaultVoiceReference: 'preset_voice_id:nimi-default',
  });
  assert.equal(snapshot.lifecycleStatus, 'active');
  assert.equal(snapshot.executionState, 'chat-active');
  assert.equal(snapshot.autonomyMode, 'high');
  assert.equal(snapshot.autonomyDailyTokenBudget, 1200);
  assert.equal(snapshot.pendingHooksCount, 1);
  assert.equal(snapshot.recentCanonicalMemories[0]?.summary, 'MingSim uses Runtime Agent');
  assert.equal(snapshot.recentCanonicalMemories[0]?.canonicalClass, 'dyadic');
});

test('Runtime Agent builders produce generated Runtime requests without old aliases', () => {
  const request = buildNimiSetRuntimeAgentPresentationProfileRequest({
    context: {
      appId: 'sdk.test',
      subjectUserId: 'user-1',
    },
    agentId: 'local-agent:user-1:realm-agent-1',
    profile: {
      backendKind: 'live2d',
      avatarAssetRef: 'avatar://agent/live2d',
      defaultVoiceReference: 'voice_asset_id:voice-1',
    },
  });
  const mutations = buildNimiRuntimeAgentStateMutations({
    statusText: 'ready',
    worldId: 'world-1',
    clearDyadicContext: true,
  });

  assert.equal(request.context?.appId, 'sdk.test');
  assert.equal(request.agentId, 'local-agent:user-1:realm-agent-1');
  assert.equal(request.mutation.oneofKind, 'profile');
  assert.equal(request.mutation.profile.backendKind, AgentPresentationBackendKind.LIVE2D);
  assert.equal(request.mutation.profile.defaultVoiceReference, 'voice_asset_id:voice-1');
  assert.deepEqual(mutations.map((mutation) => mutation.mutation.oneofKind), [
    'setStatusText',
    'setWorldContext',
    'clearDyadicContext',
  ]);
});

test('Runtime Agent protected presentation surface requests scoped Runtime access', async () => {
  const issuedScopes: string[][] = [];
  const issuedOptions: RuntimeTypedCallOptions[] = [];
  const requests: unknown[] = [];
  const runtime = {
    appId: 'sdk.test',
    auth: {
      async registerApp() {
        return {
          appInstanceId: 'sdk.test.runtime-agent',
          accepted: true,
          reasonCode: 0,
        };
      },
    },
    appAuth: {
      async authorizeExternalPrincipal(request: { scopes: string[] }) {
        issuedScopes.push(request.scopes);
        return {
          tokenId: 'token-1',
          secret: 'secret-1',
          appId: 'sdk.test',
          subjectUserId: 'user-1',
          externalPrincipalId: 'sdk.test',
          effectiveScopes: request.scopes,
          policyVersion: 'runtime-agent-v1',
          issuedScopeCatalogVersion: 'sdk-v2',
          canDelegate: false,
        };
      },
    },
    agent: {
      async setAgentPresentationProfile(request: unknown, options?: RuntimeTypedCallOptions) {
        requests.push(request);
        if (options) {
          issuedOptions.push(options);
        }
        return {};
      },
    },
  };

  const surface = createNimiHostRuntimeAgentPresentationProfileSurface({
    getRuntime: () => runtime,
    getSubjectUserId: () => 'user-1',
  });

  await surface.setPresentationProfile('local-agent:user-1:realm-agent-1', {
    backendKind: 'vrm',
    avatarAssetRef: 'avatar://agent/default',
    defaultVoiceReference: 'provider_voice_ref:voice-1',
  });

  assert.deepEqual(issuedScopes, [['runtime.agent.write']]);
  assert.equal(issuedOptions[0]?.metadata?.['x-nimi-access-token-id'], 'token-1');
  assert.equal(requests.length, 1);
});

test('Runtime Agent inspect surface reads, writes, and subscribes through protected generated methods', async () => {
  const issuedScopes: string[][] = [];
  const issuedOptions: RuntimeTypedCallOptions[] = [];
  const calls = {
    getAgent: [] as Array<Record<string, unknown>>,
    getAgentState: [] as Array<Record<string, unknown>>,
    listPendingHooks: [] as Array<Record<string, unknown>>,
    queryAgentMemory: [] as Array<Record<string, unknown>>,
    updateAgentState: [] as Array<Record<string, unknown>>,
    enableAutonomy: [] as Array<Record<string, unknown>>,
    disableAutonomy: [] as Array<Record<string, unknown>>,
    setAutonomyConfig: [] as Array<Record<string, unknown>>,
    cancelHook: [] as Array<Record<string, unknown>>,
    subscribeAgentEvents: [] as Array<Record<string, unknown>>,
  };
  const state = {
    executionState: AgentExecutionState.CHAT_ACTIVE,
    statusText: 'observing',
    activeWorldId: 'world-1',
    activeUserId: 'user-1',
    attributes: {},
    currentEmotion: 'focused',
  };
  const runtime = {
    appId: 'sdk.test',
    auth: {
      async registerApp() {
        return {
          appInstanceId: 'sdk.test.runtime-agent',
          accepted: true,
          reasonCode: 0,
        };
      },
    },
    appAuth: {
      async authorizeExternalPrincipal(request: { scopes: string[] }) {
        issuedScopes.push(request.scopes);
        return {
          tokenId: 'token-1',
          secret: 'secret-1',
          appId: 'sdk.test',
          subjectUserId: 'user-1',
          externalPrincipalId: 'sdk.test',
          effectiveScopes: request.scopes,
          policyVersion: 'runtime-agent-v1',
          issuedScopeCatalogVersion: 'sdk-v2',
          canDelegate: false,
        };
      },
    },
    agent: {
      async getAgent(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) {
        calls.getAgent.push({ ...request, __options: options });
        if (options) {
          issuedOptions.push(options);
        }
        return {
          agent: {
            lifecycleStatus: AgentLifecycleStatus.ACTIVE,
            metadata: toNimiRuntimeProtoStruct({
              presentationProfile: {
                backendKind: 'vrm',
                avatarAssetRef: 'asset://agent/default',
              },
            }),
            autonomy: {
              enabled: true,
              usedTokensInWindow: '10',
              budgetExhausted: false,
              config: {
                mode: AgentAutonomyMode.MEDIUM,
                dailyTokenBudget: '400',
                maxTokensPerHook: '120',
              },
            },
          },
        };
      },
      async getAgentState(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) {
        calls.getAgentState.push({ ...request, __options: options });
        return { state: { ...state } };
      },
      async listPendingHooks(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) {
        calls.listPendingHooks.push({ ...request, __options: options });
        if (request.admissionStateFilter === HookAdmissionState.COMPLETED) {
          return {
            hooks: [{
              intent: {
                intentId: 'hook-completed',
                admissionState: HookAdmissionState.COMPLETED,
                triggerFamily: HookTriggerFamily.TIME,
              },
              scheduledFor: toNimiRuntimeTimestamp('2026-06-05T02:00:00.000Z'),
              admittedAt: toNimiRuntimeTimestamp('2026-06-05T02:30:00.000Z'),
            }],
            nextPageToken: '',
          };
        }
        if (request.admissionStateFilter !== HookAdmissionState.UNSPECIFIED) {
          return { hooks: [], nextPageToken: '' };
        }
        return {
          hooks: [{
            intent: {
              intentId: 'hook-active',
              admissionState: HookAdmissionState.PENDING,
              triggerFamily: HookTriggerFamily.EVENT,
              triggerDetail: {
                detail: {
                  oneofKind: 'eventUserIdle',
                  eventUserIdle: {},
                },
              },
            },
            scheduledFor: toNimiRuntimeTimestamp('2026-06-05T01:00:00.000Z'),
          }],
          nextPageToken: '',
        };
      },
      async queryAgentMemory(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) {
        calls.queryAgentMemory.push({ ...request, __options: options });
        return {
          memories: [{
            canonicalClass: MemoryCanonicalClass.DYADIC,
            recallScore: 0.9,
            policyReason: 'active_context',
            record: {
              memoryId: 'memory-1',
              kind: MemoryRecordKind.EPISODIC,
              canonicalClass: MemoryCanonicalClass.DYADIC,
              provenance: {
                sourceEventId: 'turn-1',
              },
              payload: {
                oneofKind: 'episodic',
                episodic: {
                  summary: 'User likes concise diagnostics.',
                },
              },
              updatedAt: toNimiRuntimeTimestamp('2026-06-05T03:00:00.000Z'),
            },
          }],
        };
      },
      async updateAgentState(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) {
        calls.updateAgentState.push({ ...request, __options: options });
        state.statusText = 'ready';
        return { state: { ...state } };
      },
      async enableAutonomy(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) {
        calls.enableAutonomy.push({ ...request, __options: options });
        return {
          autonomy: {
            enabled: true,
            budgetExhausted: false,
            usedTokensInWindow: '0',
            config: {
              mode: AgentAutonomyMode.LOW,
              dailyTokenBudget: '100',
              maxTokensPerHook: '20',
            },
          },
        };
      },
      async disableAutonomy(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) {
        calls.disableAutonomy.push({ ...request, __options: options });
        return {
          autonomy: {
            enabled: false,
            budgetExhausted: false,
            usedTokensInWindow: '0',
            config: {
              mode: AgentAutonomyMode.OFF,
              dailyTokenBudget: '100',
              maxTokensPerHook: '20',
            },
          },
        };
      },
      async setAutonomyConfig(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) {
        calls.setAutonomyConfig.push({ ...request, __options: options });
        return {
          autonomy: {
            enabled: true,
            budgetExhausted: false,
            usedTokensInWindow: '0',
            config: request.config,
          },
        };
      },
      async cancelHook(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) {
        calls.cancelHook.push({ ...request, __options: options });
        return {
          outcome: {
            intent: {
              intentId: request.intentId,
              admissionState: HookAdmissionState.CANCELED,
            },
          },
        };
      },
      subscribeAgentEvents(request: Record<string, unknown>, options?: RuntimeTypedCallOptions) {
        calls.subscribeAgentEvents.push({ ...request, __options: options });
        async function* stream() {
          yield {
            agentId: String(request.agentId || ''),
            eventType: AgentEventType.HOOK,
            sequence: '1',
            timestamp: toNimiRuntimeTimestamp('2026-06-05T04:00:00.000Z'),
            detail: {
              oneofKind: 'hook' as const,
              hook: {
                family: HookAdmissionState.PENDING,
                intent: {
                  intentId: 'hook-active',
                  admissionState: HookAdmissionState.PENDING,
                },
              },
            },
          };
        }
        return stream();
      },
    },
  };
  const surface = createNimiHostRuntimeAgentInspectSurface({
    getRuntime: () => runtime,
    getSubjectUserId: () => 'user-1',
    maxRecentTerminalHooks: 2,
  });

  const snapshot = await surface.getPublicInspect('local-agent:user-1:agent-1');
  const updated = await surface.updateState({
    agentId: 'local-agent:user-1:agent-1',
    statusText: 'ready',
  });
  const enabled = await surface.enableAutonomy('local-agent:user-1:agent-1');
  const disabled = await surface.disableAutonomy({
    agentId: 'local-agent:user-1:agent-1',
    reason: 'sdk_test',
  });
  const config = await surface.setAutonomyConfig({
    agentId: 'local-agent:user-1:agent-1',
    mode: 'high',
    dailyTokenBudget: '640',
    maxTokensPerHook: '160',
  });
  const canceled = await surface.cancelHook({
    agentId: 'local-agent:user-1:agent-1',
    hookId: 'hook-active',
    reason: 'sdk_test',
  });
  const events: string[] = [];
  await surface.subscribePublicEvents({
    agentId: 'local-agent:user-1:agent-1',
    onEvent: (event) => {
      events.push(`${event.eventTypeLabel}:${event.hookId}`);
    },
  });

  assert.equal(snapshot.lifecycleStatus, 'active');
  assert.equal(snapshot.presentationProfile?.backendKind, 'vrm');
  assert.equal(snapshot.pendingHooks[0]?.triggerKind, 'user-idle');
  assert.equal(snapshot.recentTerminalHooks[0]?.hookId, 'hook-completed');
  assert.equal(snapshot.recentCanonicalMemories[0]?.summary, 'User likes concise diagnostics.');
  assert.deepEqual(calls.queryAgentMemory[0]?.canonicalClasses, [
    MemoryCanonicalClass.PUBLIC_SHARED,
    MemoryCanonicalClass.WORLD_SHARED,
    MemoryCanonicalClass.DYADIC,
  ]);
  assert.equal(updated.statusText, 'ready');
  assert.equal(enabled.mode, 'low');
  assert.equal(disabled.enabled, false);
  assert.equal(config.mode, 'high');
  assert.equal(canceled.status, 'canceled');
  assert.deepEqual(events, ['hook:hook-active']);
  assert.deepEqual(calls.subscribeAgentEvents[0]?.eventFilters, []);
  assert.ok(issuedScopes.some((scopes) => scopes.join(',') === 'runtime.agent.autonomy.write'));
  assert.ok(issuedScopes.some((scopes) => scopes.join(',') === 'runtime.agent.write'));
  assert.ok(issuedScopes.some((scopes) => scopes.join(',') === 'runtime.agent.read'));
  assert.equal(issuedOptions[0]?.metadata?.['x-nimi-access-token-id'], 'token-1');
  assert.equal((issuedOptions[0] as Record<string, unknown> | undefined)?.protectedAccessToken, undefined);
});

test('Runtime Agent smoke verification reads protected anchor snapshot and health evidence', async () => {
  const issuedScopes: string[][] = [];
  const issuedOptions: RuntimeTypedCallOptions[] = [];
  const anchorRequests: unknown[] = [];
  const healthOptions: RuntimeTypedCallOptions[] = [];
  const runtime = {
    appId: 'sdk.test',
    auth: {
      async registerApp() {
        return {
          appInstanceId: 'sdk.test.runtime-agent',
          accepted: true,
          reasonCode: 0,
        };
      },
    },
    appAuth: {
      async authorizeExternalPrincipal(request: { scopes: string[] }) {
        issuedScopes.push(request.scopes);
        return {
          tokenId: 'token-1',
          secret: 'secret-1',
          appId: 'sdk.test',
          subjectUserId: 'user-1',
          externalPrincipalId: 'sdk.test',
          effectiveScopes: request.scopes,
          policyVersion: 'runtime-agent-v1',
          issuedScopeCatalogVersion: 'sdk-v2',
          canDelegate: false,
        };
      },
    },
    agents: {
      async getConversationAnchorSnapshot(request: unknown, options?: RuntimeTypedCallOptions) {
        anchorRequests.push(request);
        if (options) {
          issuedOptions.push(options);
        }
        return {
          snapshot: {
            anchor: {
              conversationAnchorId: 'anchor-1',
              agentId: 'local-agent:user-1:agent-1',
              subjectUserId: 'user-1',
              status: 1,
              lastTurnId: 'turn-1',
              lastMessageId: 'message-1',
              localAgentRef: 'local-agent:user-1:agent-1',
              ownerUserId: 'user-1',
              realmAgentId: 'agent-1',
            },
            activeTurnId: '',
            activeStreamId: 'stream-1',
          },
        };
      },
    },
    async health(_request = {}, options?: RuntimeTypedCallOptions) {
      if (options) {
        healthOptions.push(options);
      }
      return {
        status: RuntimeHealthStatus.READY,
        reason: 'ready',
        queueDepth: 1,
        activeWorkflows: 2,
        activeInferenceJobs: 3,
        cpuMilli: '10',
        memoryBytes: '20',
        vramBytes: '30',
        sampledAt: toNimiRuntimeTimestamp('2026-06-05T00:00:00.000Z'),
      };
    },
  };

  const surface = createNimiRuntimeAgentSmokeVerificationSurface({
    getRuntime: () => runtime,
    getSubjectUserId: () => 'user-1',
  });

  const evidence = await surface.readProductPathEvidence({
    agentId: 'local-agent:user-1:agent-1',
    conversationAnchorId: 'anchor-1',
  });

  assert.deepEqual(issuedScopes, [['runtime.agent.read']]);
  assert.equal(issuedOptions[0]?.metadata?.['x-nimi-access-token-id'], 'token-1');
  assert.equal(healthOptions.length, 1);
  assert.deepEqual(anchorRequests[0], {
    context: {
      appId: 'sdk.test',
      subjectUserId: 'user-1',
      ownerUserId: 'user-1',
      realmAgentId: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
    },
    agentId: 'local-agent:user-1:agent-1',
    conversationAnchorId: 'anchor-1',
  });
  assert.equal(evidence.same_anchor, true);
  assert.equal(evidence.runtime_authenticated, true);
  assert.deepEqual(evidence.runtime_auth_scopes, ['runtime.agent.read']);
  assert.equal(evidence.runtime_health.sampled_at, '2026-06-05T00:00:00.000Z');
  assert.equal(evidence.anchor_snapshot.last_turn_id, 'turn-1');
  assert.equal(evidence.has_runtime_turn, true);
});
