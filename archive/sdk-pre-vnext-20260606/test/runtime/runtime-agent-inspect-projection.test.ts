import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentAutonomyMode,
  AgentEventType,
  AgentExecutionState,
  AgentLifecycleStatus,
  HookAdmissionState,
  HookTriggerFamily,
  MemoryCanonicalClass,
  MemoryRecordKind,
  MemoryReplicationOutcome,
  buildRuntimeAgentStateMutations,
  normalizeRuntimeAgentAutonomyModeInput,
  projectRuntimeAgentAutonomySnapshot,
  projectRuntimeAgentCanonicalMemoryInspect,
  projectRuntimeAgentInspectEventSummary,
  projectRuntimeAgentInspectSnapshot,
  projectRuntimeAgentPendingHookInspect,
  readRuntimeAgentPresentationProfile,
  toProtoStruct,
  toRuntimeAgentAutonomyMode,
} from '../../src/runtime/index.js';

test('runtime agent inspect projection decodes presentation metadata and autonomy', () => {
  const metadata = toProtoStruct({
    presentationProfile: {
      backendKind: 'live2d',
      avatarAssetRef: 'asset://live2d/agent-1',
      idlePreset: 'soft-idle',
      defaultVoiceReference: 'voice://agent-1/default',
    },
  });

  assert.deepEqual(readRuntimeAgentPresentationProfile(metadata), {
    backendKind: 'live2d',
    avatarAssetRef: 'asset://live2d/agent-1',
    expressionProfileRef: null,
    idlePreset: 'soft-idle',
    interactionPolicyRef: null,
    defaultVoiceReference: 'voice://agent-1/default',
  });

  assert.deepEqual(projectRuntimeAgentAutonomySnapshot({
    enabled: true,
    config: {
      mode: AgentAutonomyMode.MEDIUM,
      dailyTokenBudget: '400',
      maxTokensPerHook: '120',
    },
    usedTokensInWindow: '88',
    windowStartedAt: { seconds: '1776124800', nanos: 500_000_000 },
    budgetExhausted: false,
  }), {
    mode: 'medium',
    enabled: true,
    budgetExhausted: false,
    usedTokensInWindow: 88,
    dailyTokenBudget: 400,
    maxTokensPerHook: 120,
    windowStartedAt: '2026-04-14T00:00:00.500Z',
    suspendedUntil: null,
  });
});

test('runtime agent hook and memory projections format runtime-owned enums', () => {
  assert.deepEqual(projectRuntimeAgentPendingHookInspect({
    intent: {
      intentId: 'hook-1',
      agentId: 'agent-1',
      conversationAnchorId: '',
      originatingTurnId: '',
      originatingStreamId: '',
      triggerFamily: HookTriggerFamily.EVENT,
      triggerDetail: {
        detail: {
          oneofKind: 'eventUserIdle',
          eventUserIdle: {},
        },
      },
      effect: 1,
      admissionState: HookAdmissionState.PENDING,
      reason: '',
    },
    scheduledFor: { seconds: '1776135600', nanos: 0 },
  }), {
    hookId: 'hook-1',
    status: 'pending',
    triggerKind: 'user-idle',
    scheduledFor: '2026-04-14T03:00:00.000Z',
    admittedAt: null,
  });

  assert.deepEqual(projectRuntimeAgentCanonicalMemoryInspect({
    canonicalClass: MemoryCanonicalClass.DYADIC,
    recallScore: 0.87,
    policyReason: 'recent',
    record: {
      memoryId: 'memory-1',
      kind: MemoryRecordKind.SEMANTIC,
      canonicalClass: MemoryCanonicalClass.DYADIC,
      provenance: {
        sourceEventId: 'event-1',
        sourceKind: 0,
        capturedAt: undefined,
        confidence: 0,
      },
      payload: {
        oneofKind: 'semantic',
        semantic: {
          subject: 'Ren',
          predicate: 'likes',
          object: 'tea',
          confidence: 0.9,
        },
      },
      updatedAt: { seconds: '1776137100', nanos: 0 },
    },
  }), {
    memoryId: 'memory-1',
    canonicalClass: 'dyadic',
    kind: 'semantic',
    summary: 'Ren likes tea',
    updatedAt: '2026-04-14T03:25:00.000Z',
    sourceEventId: 'event-1',
    policyReason: 'recent',
    recallScore: 0.87,
  });
});

test('runtime agent inspect snapshot projects state, hooks, and memories together', () => {
  const snapshot = projectRuntimeAgentInspectSnapshot({
    agent: {
      lifecycleStatus: AgentLifecycleStatus.ACTIVE,
      metadata: undefined,
      autonomy: {
        enabled: false,
        config: {
          mode: AgentAutonomyMode.OFF,
          dailyTokenBudget: '0',
          maxTokensPerHook: '0',
        },
        usedTokensInWindow: '0',
        budgetExhausted: false,
      },
    },
    state: {
      executionState: AgentExecutionState.LIFE_PENDING,
      statusText: ' waiting ',
      activeWorldId: 'world-1',
      activeUserId: '',
      attributes: {},
      currentEmotion: '',
    },
    activeHooks: [
      {
        hookId: 'hook-active',
        status: 'pending',
        triggerKind: 'scheduled-time',
        scheduledFor: '2026-04-14T05:40:00.000Z',
      },
    ],
    terminalHooks: [
      {
        hookId: 'hook-old',
        status: 'completed',
        triggerKind: 'scheduled-time',
        scheduledFor: '2026-04-14T04:40:00.000Z',
        admittedAt: '2026-04-14T04:41:00.000Z',
      },
      {
        hookId: 'hook-new',
        status: 'failed',
        triggerKind: 'scheduled-time',
        scheduledFor: '2026-04-14T04:40:00.000Z',
        admittedAt: '2026-04-14T04:42:00.000Z',
      },
    ],
    recentCanonicalMemories: [],
    maxRecentTerminalHooks: 1,
  });

  assert.equal(snapshot.lifecycleStatus, 'active');
  assert.equal(snapshot.executionState, 'life-pending');
  assert.equal(snapshot.statusText, 'waiting');
  assert.equal(snapshot.activeWorldId, 'world-1');
  assert.equal(snapshot.pendingHooksCount, 1);
  assert.equal(snapshot.nextScheduledFor, '2026-04-14T05:40:00.000Z');
  assert.deepEqual(snapshot.recentTerminalHooks.map((hook) => hook.hookId), ['hook-new']);
});

test('runtime agent event summary and mutation builders stay typed and fail closed', () => {
  assert.deepEqual(projectRuntimeAgentInspectEventSummary({
    event: {
      agentId: '',
      eventType: AgentEventType.REPLICATION,
      sequence: '42',
      timestamp: { seconds: '1776136500', nanos: 0 },
      localAgentRef: '',
      ownerUserId: '',
      realmAgentId: '',
      detail: {
        oneofKind: 'replication',
        replication: {
          memoryId: 'memory-1',
          replication: {
            outcome: MemoryReplicationOutcome.SYNCED,
            localVersion: 'test-local-version',
            basisVersion: 'test-basis-version',
            detail: {
              oneofKind: 'synced',
              synced: { realmVersion: 'test-realm-version', syncedAt: undefined },
            },
          },
        },
      },
    },
    fallbackAgentId: 'agent-1',
  }), {
    agentId: 'agent-1',
    eventType: AgentEventType.REPLICATION,
    eventTypeLabel: 'replication',
    sequence: '42',
    detailKind: 'replication',
    timestamp: '2026-04-14T03:15:00.000Z',
    summaryText: 'memory-1 · synced',
    hookId: null,
    hookStatus: null,
    lifecycleStatus: null,
    budgetExhausted: null,
    remainingTokens: null,
  });

  assert.equal(normalizeRuntimeAgentAutonomyModeInput('invalid'), 'off');
  assert.equal(toRuntimeAgentAutonomyMode('high'), AgentAutonomyMode.HIGH);
  assert.deepEqual(buildRuntimeAgentStateMutations({
    statusText: ' ready ',
    clearWorldContext: true,
    userId: 'user-1',
  }).map((mutation) => mutation.mutation.oneofKind), [
    'setStatusText',
    'clearWorldContext',
    'setDyadicContext',
  ]);
});
