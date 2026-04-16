import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCanonicalClass, RuntimeReasonCode } from '@nimiplatform/sdk/runtime';
import { createRuntimeAgentInspectAdapter } from '../src/shell/renderer/infra/runtime-agent-inspect.js';

function createRuntimeMock() {
  const calls = {
    registerApp: [] as Array<Record<string, unknown>>,
    authorizeExternalPrincipal: [] as Array<Record<string, unknown>>,
    getAgent: [] as Array<Record<string, unknown>>,
    getAgentState: [] as Array<Record<string, unknown>>,
    updateAgentState: [] as Array<Record<string, unknown>>,
    listPendingHooks: [] as Array<Record<string, unknown>>,
    queryMemory: [] as Array<Record<string, unknown>>,
    enableAutonomy: [] as Array<Record<string, unknown>>,
    disableAutonomy: [] as Array<Record<string, unknown>>,
    setAutonomyConfig: [] as Array<Record<string, unknown>>,
    cancelHook: [] as Array<Record<string, unknown>>,
    subscribeEvents: [] as Array<Record<string, unknown>>,
  };

  const state = {
    executionState: 3,
    statusText: 'waiting to follow up',
    activeWorldId: 'world-1',
    activeUserId: 'user-1',
  };

  const runtime = {
    appId: 'desktop-test',
    auth: {
      registerApp: async (input: Record<string, unknown>) => {
        calls.registerApp.push(input);
        return { accepted: true };
      },
    },
    appAuth: {
      authorizeExternalPrincipal: async (input: Record<string, unknown>) => {
        calls.authorizeExternalPrincipal.push(input);
        return {
          tokenId: 'protected-token-id',
          secret: 'protected-token-secret',
        };
      },
    },
    agentCore: {
      getAgent: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.getAgent.push({ ...input, __options: options });
        return {
          agent: {
            lifecycleStatus: 2,
            metadata: {
              fields: {
                presentationProfile: {
                  kind: {
                    oneofKind: 'structValue',
                    structValue: {
                      fields: {
                        backendKind: {
                          kind: {
                            oneofKind: 'stringValue',
                            stringValue: 'sprite2d',
                          },
                        },
                        avatarAssetRef: {
                          kind: {
                            oneofKind: 'stringValue',
                            stringValue: 'https://cdn.nimi.test/agents/agent-1.png',
                          },
                        },
                        idlePreset: {
                          kind: {
                            oneofKind: 'stringValue',
                            stringValue: 'companion.idle.soft',
                          },
                        },
                        defaultVoiceReference: {
                          kind: {
                            oneofKind: 'stringValue',
                            stringValue: 'voice://agent-1/default',
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            autonomy: {
              enabled: true,
              usedTokensInWindow: '88',
              budgetExhausted: false,
              windowStartedAt: { seconds: '1776124800', nanos: 0 },
              config: {
                dailyTokenBudget: '400',
                maxTokensPerHook: '120',
              },
            },
          },
        };
      },
      getAgentState: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.getAgentState.push({ ...input, __options: options });
        return {
          state: {
            ...state,
          },
        };
      },
      updateAgentState: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.updateAgentState.push({ ...input, __options: options });
        for (const mutation of (input.mutations as Array<Record<string, unknown>> | undefined) || []) {
          const detail = mutation.mutation as Record<string, unknown> | undefined;
          switch (detail?.oneofKind) {
            case 'setStatusText':
              state.statusText = String((detail.setStatusText as Record<string, unknown> | undefined)?.statusText || '').trim();
              break;
            case 'setWorldContext':
              state.activeWorldId = String((detail.setWorldContext as Record<string, unknown> | undefined)?.worldId || '').trim();
              break;
            case 'clearWorldContext':
              state.activeWorldId = '';
              break;
            case 'setDyadicContext':
              state.activeUserId = String((detail.setDyadicContext as Record<string, unknown> | undefined)?.userId || '').trim();
              break;
            case 'clearDyadicContext':
              state.activeUserId = '';
              break;
            default:
              break;
          }
        }
        return {
          state: {
            ...state,
          },
        };
      },
      listPendingHooks: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.listPendingHooks.push({ ...input, __options: options });
        const pendingHooks = [
          {
            hookId: 'hook-1',
            status: 1,
            trigger: { triggerKind: 2 },
            scheduledFor: { seconds: '1776135600', nanos: 0 },
          },
          {
            hookId: 'hook-2',
            status: 2,
            trigger: { triggerKind: 1 },
            scheduledFor: { seconds: '1776135900', nanos: 0 },
          },
          {
            hookId: 'hook-3',
            status: 1,
            trigger: { triggerKind: 4 },
            scheduledFor: { seconds: '1776136200', nanos: 0 },
          },
          {
            hookId: 'hook-4',
            status: 2,
            trigger: { triggerKind: 5 },
            scheduledFor: { seconds: '1776136500', nanos: 0 },
          },
        ];
        const completedHooks = Array.from({ length: 205 }, (_value, index) => ({
          hookId: `hook-completed-${String(index + 1).padStart(3, '0')}`,
          status: 3,
          trigger: { triggerKind: 1 },
          scheduledFor: { seconds: String(1776135600 + index), nanos: 0 },
          admittedAt: { seconds: String(1776136600 + index), nanos: 0 },
        }));
        const hooksByStatus: Record<string, Array<Record<string, unknown>>> = {
          '0': pendingHooks,
          '3': completedHooks,
          '4': [{
            hookId: 'hook-failed-1',
            status: 4,
            trigger: { triggerKind: 6 },
            scheduledFor: { seconds: '1776131000', nanos: 0 },
            admittedAt: { seconds: '1776137001', nanos: 0 },
          }],
          '5': [{
            hookId: 'hook-canceled-1',
            status: 5,
            trigger: { triggerKind: 2 },
            scheduledFor: { seconds: '1776131100', nanos: 0 },
            admittedAt: { seconds: '1776137002', nanos: 0 },
          }],
          '6': [{
            hookId: 'hook-rescheduled-1',
            status: 6,
            trigger: { triggerKind: 3 },
            scheduledFor: { seconds: '1776131200', nanos: 0 },
            admittedAt: { seconds: '1776137003', nanos: 0 },
          }],
          '7': [{
            hookId: 'hook-rejected-1',
            status: 7,
            trigger: { triggerKind: 7 },
            scheduledFor: { seconds: '1776131300', nanos: 0 },
            admittedAt: { seconds: '1776137004', nanos: 0 },
          }],
        };
        const hooks = hooksByStatus[String(input.statusFilter || 0)] || [];
        const pageSize = Number(input.pageSize || 0) || 50;
        const start = Number(input.pageToken || 0) || 0;
        const end = Math.min(start + pageSize, hooks.length);
        return {
          hooks: hooks.slice(start, end),
          nextPageToken: end < hooks.length ? String(end) : '',
        };
      },
      queryMemory: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.queryMemory.push({ ...input, __options: options });
        return {
          memories: [
            {
              canonicalClass: MemoryCanonicalClass.WORLD_SHARED,
              sourceBank: {
                owner: {
                  oneofKind: 'worldShared',
                  worldShared: {
                    worldId: 'world-1',
                  },
                },
              },
              record: {
                memoryId: 'mem-world-1',
                kind: 2,
                canonicalClass: MemoryCanonicalClass.WORLD_SHARED,
                provenance: {
                  sourceEventId: 'turn-world-1',
                },
                payload: {
                  oneofKind: 'semantic',
                  semantic: {
                    subject: 'World One',
                    predicate: 'contains',
                    object: 'the tea house',
                  },
                },
                updatedAt: { seconds: '1776137100', nanos: 0 },
              },
              recallScore: 0,
              policyReason: 'query_agent_memory_history',
            },
            {
              canonicalClass: MemoryCanonicalClass.DYADIC,
              sourceBank: {
                owner: {
                  oneofKind: 'agentDyadic',
                  agentDyadic: {
                    agentId: 'agent-1',
                    userId: 'user-1',
                  },
                },
              },
              record: {
                memoryId: 'mem-dyadic-1',
                kind: 3,
                canonicalClass: MemoryCanonicalClass.DYADIC,
                provenance: {
                  sourceEventId: 'turn-dyadic-1',
                },
                payload: {
                  oneofKind: 'observational',
                  observational: {
                    observation: 'user prefers jasmine tea',
                  },
                },
                updatedAt: { seconds: '1776137000', nanos: 0 },
              },
              recallScore: 0,
              policyReason: 'query_agent_memory_history',
            },
            {
              canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED,
              sourceBank: {
                owner: {
                  oneofKind: 'agentCore',
                  agentCore: {
                    agentId: 'agent-1',
                  },
                },
              },
              record: {
                memoryId: 'mem-core-1',
                kind: 1,
                canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED,
                provenance: {
                  sourceEventId: 'turn-core-1',
                },
                payload: {
                  oneofKind: 'episodic',
                  episodic: {
                    summary: 'Met at the tea house after sunset.',
                  },
                },
                updatedAt: { seconds: '1776136900', nanos: 0 },
              },
              recallScore: 0,
              policyReason: 'query_agent_memory_history',
            },
          ],
          narratives: [],
        };
      },
      enableAutonomy: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.enableAutonomy.push({ ...input, __options: options });
        return {
          autonomy: {
            enabled: true,
            usedTokensInWindow: '90',
            budgetExhausted: false,
            config: {
              dailyTokenBudget: '400',
              maxTokensPerHook: '120',
            },
          },
        };
      },
      disableAutonomy: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.disableAutonomy.push({ ...input, __options: options });
        return {
          autonomy: {
            enabled: false,
            usedTokensInWindow: '90',
            budgetExhausted: false,
            config: {
              dailyTokenBudget: '400',
              maxTokensPerHook: '120',
            },
          },
        };
      },
      setAutonomyConfig: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.setAutonomyConfig.push({ ...input, __options: options });
        return {
          autonomy: {
            enabled: true,
            usedTokensInWindow: '90',
            budgetExhausted: false,
            config: {
              dailyTokenBudget: String((input.config as Record<string, unknown>)?.dailyTokenBudget || '0'),
              maxTokensPerHook: String((input.config as Record<string, unknown>)?.maxTokensPerHook || '0'),
            },
          },
        };
      },
      cancelHook: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.cancelHook.push({ ...input, __options: options });
        return {
          outcome: {
            hookId: String(input.hookId || ''),
            status: 5,
          },
        };
      },
      subscribeEvents: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.subscribeEvents.push({ ...input, __options: options });
        async function* stream() {
          yield {
            agentId: String(input.agentId || ''),
            eventType: 2,
            sequence: '17',
            timestamp: { seconds: '1776135600', nanos: 0 },
            detail: {
              oneofKind: 'hook',
              hook: {
                outcome: {
                  hookId: 'hook-1',
                  status: 1,
                },
              },
            },
          };
          yield {
            agentId: String(input.agentId || ''),
            eventType: 4,
            sequence: '18',
            timestamp: { seconds: '1776135900', nanos: 0 },
            detail: {
              oneofKind: 'budget',
              budget: {
                budgetExhausted: false,
                remainingTokens: '312',
              },
            },
          };
          yield {
            agentId: String(input.agentId || ''),
            eventType: 3,
            sequence: '19',
            timestamp: { seconds: '1776136200', nanos: 0 },
            detail: {
              oneofKind: 'memory',
              memory: {
                accepted: [{ canonicalClass: MemoryCanonicalClass.DYADIC }],
                rejected: [{ sourceEventId: 'candidate-2', reasonCode: RuntimeReasonCode.AI_OUTPUT_INVALID, message: 'bad' }],
              },
            },
          };
          yield {
            agentId: String(input.agentId || ''),
            eventType: 5,
            sequence: '20',
            timestamp: { seconds: '1776136500', nanos: 0 },
            detail: {
              oneofKind: 'replication',
              replication: {
                memoryId: 'mem-dyadic-1',
                replication: {
                  outcome: 2,
                  localVersion: 'v2',
                  basisVersion: 'v1',
                  detail: {
                    oneofKind: 'synced',
                    synced: {
                      remoteVersion: 'v2',
                    },
                  },
                },
              },
            },
          };
        }
        return stream();
      },
    },
  };

  return { runtime, calls };
}

test('runtime agent inspect adapter does not touch platform runtime before first operation', () => {
  let getRuntimeCalls = 0;
  createRuntimeAgentInspectAdapter({
    getRuntime: () => {
      getRuntimeCalls += 1;
      throw new Error('getRuntime should not run during adapter creation');
    },
  });
  assert.equal(getRuntimeCalls, 0);
});

test('runtime agent inspect adapter projects public state and pending hook summaries', async () => {
  const { runtime, calls } = createRuntimeMock();
  const adapter = createRuntimeAgentInspectAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
  });

  const snapshot = await adapter.getPublicInspect('agent-1');

  assert.equal(snapshot.lifecycleStatus, 'active');
  assert.deepEqual(snapshot.presentationProfile, {
    backendKind: 'sprite2d',
    avatarAssetRef: 'https://cdn.nimi.test/agents/agent-1.png',
    expressionProfileRef: null,
    idlePreset: 'companion.idle.soft',
    interactionPolicyRef: null,
    defaultVoiceReference: 'voice://agent-1/default',
  });
  assert.equal(snapshot.executionState, 'life-pending');
  assert.equal(snapshot.statusText, 'waiting to follow up');
  assert.equal(snapshot.activeWorldId, 'world-1');
  assert.equal(snapshot.activeUserId, 'user-1');
  assert.equal(snapshot.autonomyEnabled, true);
  assert.equal(snapshot.autonomyBudgetExhausted, false);
  assert.equal(snapshot.autonomyUsedTokensInWindow, 88);
  assert.equal(snapshot.autonomyDailyTokenBudget, 400);
  assert.equal(snapshot.autonomyMaxTokensPerHook, 120);
  assert.equal(snapshot.pendingHooksCount, 4);
  assert.equal(snapshot.pendingHooks.length, 3);
  assert.equal(snapshot.pendingHooks[0]?.hookId, 'hook-1');
  assert.equal(snapshot.pendingHooks[0]?.status, 'pending');
  assert.equal(snapshot.pendingHooks[0]?.triggerKind, 'scheduled-time');
  assert.equal(snapshot.pendingHooks[1]?.status, 'running');
  assert.equal(snapshot.pendingHooks[1]?.triggerKind, 'turn-completed');
  assert.equal(snapshot.pendingHooks[2]?.hookId, 'hook-3');
  assert.equal(snapshot.nextScheduledFor, '2026-04-14T03:00:00.000Z');
  assert.equal(snapshot.recentTerminalHooks.length, 6);
  assert.equal(snapshot.recentTerminalHooks[0]?.hookId, 'hook-rejected-1');
  assert.equal(snapshot.recentTerminalHooks[0]?.status, 'rejected');
  assert.equal(snapshot.recentTerminalHooks[1]?.hookId, 'hook-rescheduled-1');
  assert.equal(snapshot.recentTerminalHooks[2]?.hookId, 'hook-canceled-1');
  assert.equal(snapshot.recentTerminalHooks[3]?.hookId, 'hook-failed-1');
  assert.equal(snapshot.recentTerminalHooks[4]?.hookId, 'hook-completed-205');
  assert.equal(snapshot.recentCanonicalMemories.length, 3);
  assert.equal(snapshot.recentCanonicalMemories[0]?.memoryId, 'mem-world-1');
  assert.equal(snapshot.recentCanonicalMemories[0]?.canonicalClass, 'world-shared');
  assert.equal(snapshot.recentCanonicalMemories[0]?.kind, 'semantic');
  assert.match(snapshot.recentCanonicalMemories[0]?.summary || '', /tea house/);
  assert.equal(snapshot.recentCanonicalMemories[1]?.canonicalClass, 'dyadic');
  assert.equal(snapshot.recentCanonicalMemories[2]?.canonicalClass, 'public-shared');

  assert.equal(calls.getAgent.length, 1);
  assert.equal(calls.getAgentState.length, 1);
  assert.equal(calls.listPendingHooks.length, 7);
  assert.equal(calls.queryMemory.length, 1);
  assert.deepEqual(calls.queryMemory[0]?.canonicalClasses, [
    MemoryCanonicalClass.PUBLIC_SHARED,
    MemoryCanonicalClass.WORLD_SHARED,
    MemoryCanonicalClass.DYADIC,
  ]);
  assert.equal(calls.registerApp.length, 1);
  assert.ok(calls.authorizeExternalPrincipal.length >= 1);
  const options = (calls.getAgent[0]?.__options as Record<string, unknown>) || {};
  assert.deepEqual(options.protectedAccessToken, {
    tokenId: 'protected-token-id',
    secret: 'protected-token-secret',
  });
});

test('runtime agent inspect adapter projects persistent presentation profile without loading inspect extras', async () => {
  const { runtime, calls } = createRuntimeMock();
  const adapter = createRuntimeAgentInspectAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
  });

  const profile = await adapter.getPresentationProfile('agent-1');

  assert.deepEqual(profile, {
    backendKind: 'sprite2d',
    avatarAssetRef: 'https://cdn.nimi.test/agents/agent-1.png',
    expressionProfileRef: null,
    idlePreset: 'companion.idle.soft',
    interactionPolicyRef: null,
    defaultVoiceReference: 'voice://agent-1/default',
  });
  assert.equal(calls.getAgent.length, 1);
  assert.equal(calls.getAgentState.length, 0);
  assert.equal(calls.queryMemory.length, 0);
});

test('runtime agent inspect adapter enables and disables autonomy through admitted runtime writes', async () => {
  const { runtime, calls } = createRuntimeMock();
  const adapter = createRuntimeAgentInspectAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
  });

  const enabled = await adapter.enableAutonomy('agent-1');
  const disabled = await adapter.disableAutonomy({
    agentId: 'agent-1',
    reason: 'desktop_test_disable',
  });

  assert.equal(enabled.enabled, true);
  assert.equal(enabled.dailyTokenBudget, 400);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.maxTokensPerHook, 120);
  assert.equal(calls.enableAutonomy.length, 1);
  assert.equal(calls.disableAutonomy.length, 1);
  assert.equal(calls.disableAutonomy[0]?.reason, 'desktop_test_disable');
  const enableOptions = (calls.enableAutonomy[0]?.__options as Record<string, unknown>) || {};
  assert.deepEqual(enableOptions.protectedAccessToken, {
    tokenId: 'protected-token-id',
    secret: 'protected-token-secret',
  });
});

test('runtime agent inspect adapter updates admitted agent state through runtime.agent.write', async () => {
  const { runtime, calls } = createRuntimeMock();
  const adapter = createRuntimeAgentInspectAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
  });

  const updated = await adapter.updateState({
    agentId: 'agent-1',
    statusText: 'ready for tea',
    worldId: 'world-2',
    userId: 'user-7',
  });
  const cleared = await adapter.updateState({
    agentId: 'agent-1',
    clearWorldContext: true,
    clearDyadicContext: true,
  });

  assert.equal(updated.statusText, 'ready for tea');
  assert.equal(updated.activeWorldId, 'world-2');
  assert.equal(updated.activeUserId, 'user-7');
  assert.equal(cleared.activeWorldId, null);
  assert.equal(cleared.activeUserId, null);
  assert.equal(calls.updateAgentState.length, 2);
  assert.equal(((calls.updateAgentState[0]?.mutations as Array<Record<string, unknown>>)[0]?.mutation as Record<string, unknown>)?.oneofKind, 'setStatusText');
  assert.equal(((calls.updateAgentState[0]?.mutations as Array<Record<string, unknown>>)[1]?.mutation as Record<string, unknown>)?.oneofKind, 'setWorldContext');
  assert.equal(((calls.updateAgentState[0]?.mutations as Array<Record<string, unknown>>)[2]?.mutation as Record<string, unknown>)?.oneofKind, 'setDyadicContext');
  const options = (calls.updateAgentState[0]?.__options as Record<string, unknown>) || {};
  assert.deepEqual(options.protectedAccessToken, {
    tokenId: 'protected-token-id',
    secret: 'protected-token-secret',
  });
});

test('runtime agent inspect adapter updates autonomy config through admitted runtime writes', async () => {
  const { runtime, calls } = createRuntimeMock();
  const adapter = createRuntimeAgentInspectAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
  });

  const updated = await adapter.setAutonomyConfig({
    agentId: 'agent-1',
    dailyTokenBudget: '640',
    maxTokensPerHook: '160',
  });

  assert.equal(updated.enabled, true);
  assert.equal(updated.dailyTokenBudget, 640);
  assert.equal(updated.maxTokensPerHook, 160);
  assert.equal(calls.setAutonomyConfig.length, 1);
  assert.equal((calls.setAutonomyConfig[0]?.config as Record<string, unknown>)?.dailyTokenBudget, '640');
  assert.equal((calls.setAutonomyConfig[0]?.config as Record<string, unknown>)?.maxTokensPerHook, '160');
  const options = (calls.setAutonomyConfig[0]?.__options as Record<string, unknown>) || {};
  assert.deepEqual(options.protectedAccessToken, {
    tokenId: 'protected-token-id',
    secret: 'protected-token-secret',
  });
});

test('runtime agent inspect adapter cancels hooks through admitted runtime writes', async () => {
  const { runtime, calls } = createRuntimeMock();
  const adapter = createRuntimeAgentInspectAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
  });

  const outcome = await adapter.cancelHook({
    agentId: 'agent-1',
    hookId: 'hook-1',
    reason: 'desktop_test_cancel',
  });

  assert.equal(outcome.hookId, 'hook-1');
  assert.equal(outcome.status, 'canceled');
  assert.equal(calls.cancelHook.length, 1);
  assert.equal(calls.cancelHook[0]?.reason, 'desktop_test_cancel');
  const options = (calls.cancelHook[0]?.__options as Record<string, unknown>) || {};
  assert.deepEqual(options.protectedAccessToken, {
    tokenId: 'protected-token-id',
    secret: 'protected-token-secret',
  });
});

test('runtime agent inspect adapter subscribes to agent events with protected read scopes', async () => {
  const { runtime, calls } = createRuntimeMock();
  const adapter = createRuntimeAgentInspectAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
  });
  const events: Array<{ eventType: number; sequence: string; detailKind: string | null }> = [];

  await adapter.subscribePublicEvents({
    agentId: 'agent-1',
    onEvent: async (event) => {
      events.push({
        eventType: event.eventType,
        sequence: event.sequence,
        detailKind: event.detailKind,
      });
      if (events.length === 1) {
        assert.equal(event.eventTypeLabel, 'hook');
        assert.equal(event.hookId, 'hook-1');
        assert.equal(event.hookStatus, 'pending');
        assert.match(event.summaryText || '', /hook-1 · pending/);
      }
      if (events.length === 2) {
        assert.equal(event.eventTypeLabel, 'budget');
        assert.equal(event.budgetExhausted, false);
        assert.equal(event.remainingTokens, 312);
      }
      if (events.length === 3) {
        assert.equal(event.eventTypeLabel, 'memory');
        assert.equal(event.summaryText, 'accepted=1 · rejected=1');
      }
      if (events.length === 4) {
        assert.equal(event.eventTypeLabel, 'replication');
        assert.equal(event.summaryText, 'mem-dyadic-1 · synced');
      }
    },
  });

  assert.deepEqual(events, [
    { eventType: 2, sequence: '17', detailKind: 'hook' },
    { eventType: 4, sequence: '18', detailKind: 'budget' },
    { eventType: 3, sequence: '19', detailKind: 'memory' },
    { eventType: 5, sequence: '20', detailKind: 'replication' },
  ]);
  assert.equal(calls.subscribeEvents.length, 1);
  assert.deepEqual(calls.subscribeEvents[0]?.eventFilters, []);
  const options = (calls.subscribeEvents[0]?.__options as Record<string, unknown>) || {};
  assert.deepEqual(options.protectedAccessToken, {
    tokenId: 'protected-token-id',
    secret: 'protected-token-secret',
  });
});
