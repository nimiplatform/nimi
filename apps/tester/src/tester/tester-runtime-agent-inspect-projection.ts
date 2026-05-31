import {
  AgentAutonomyMode,
  AgentEventType,
  AgentExecutionState,
  AgentLifecycleStatus,
  HookAdmissionState,
  HookTriggerFamily,
  MemoryReplicationOutcome,
  buildRuntimeAgentStateMutations,
  projectRuntimeAgentInspectEventSummary,
  projectRuntimeAgentInspectSnapshot,
  projectRuntimeAgentPendingHookInspect,
  readRuntimeAgentPresentationProfile,
  toProtoStruct,
} from '@nimiplatform/sdk/runtime';

export type TesterRuntimeAgentInspectProjection = {
  lifecycleStatus: string | null;
  presentationBackend: string;
  nextHookStatus: string | null;
  eventSummary: string | null;
  mutationKinds: string;
};

export function createTesterRuntimeAgentInspectProjection(): TesterRuntimeAgentInspectProjection {
  const metadata = toProtoStruct({
    presentationProfile: {
      backendKind: 'vrm',
      avatarAssetRef: 'asset://tester/vrm-agent',
    },
  });
  const presentation = readRuntimeAgentPresentationProfile(metadata);
  const pendingHook = projectRuntimeAgentPendingHookInspect({
    intent: {
      intentId: 'tester-hook',
      agentId: 'tester-agent',
      conversationAnchorId: 'tester-anchor',
      originatingTurnId: '',
      originatingStreamId: '',
      triggerFamily: HookTriggerFamily.EVENT,
      triggerDetail: {
        detail: {
          oneofKind: 'eventChatEnded',
          eventChatEnded: {},
        },
      },
      effect: 1,
      admissionState: HookAdmissionState.PENDING,
      reason: '',
    },
    scheduledFor: { seconds: '1776135600', nanos: 0 },
  });
  const snapshot = projectRuntimeAgentInspectSnapshot({
    agent: {
      lifecycleStatus: AgentLifecycleStatus.ACTIVE,
      metadata,
      autonomy: {
        enabled: true,
        config: {
          mode: AgentAutonomyMode.LOW,
          dailyTokenBudget: '80',
          maxTokensPerHook: '20',
        },
        usedTokensInWindow: '4',
        budgetExhausted: false,
      },
    },
    state: {
      executionState: AgentExecutionState.IDLE,
      statusText: 'tester ready',
      activeWorldId: '',
      activeUserId: 'tester-user',
      attributes: {},
      currentEmotion: '',
    },
    activeHooks: [pendingHook],
    terminalHooks: [],
    recentCanonicalMemories: [],
  });
  const event = projectRuntimeAgentInspectEventSummary({
    event: {
      agentId: 'tester-agent',
      eventType: AgentEventType.REPLICATION,
      sequence: '7',
      localAgentRef: 'local-agent:tester-user:tester-agent',
      ownerUserId: 'tester-user',
      realmAgentId: 'tester-agent',
      timestamp: { seconds: '1776136500', nanos: 0 },
      detail: {
        oneofKind: 'replication',
        replication: {
          memoryId: 'tester-memory',
          replication: {
            outcome: MemoryReplicationOutcome.SYNCED,
            localVersion: 'tester-local-version',
            basisVersion: 'tester-basis-version',
            detail: {
              oneofKind: 'synced',
              synced: { realmVersion: 'tester-realm-version', syncedAt: undefined },
            },
          },
        },
      },
    },
  });
  const mutationKinds = buildRuntimeAgentStateMutations({
    statusText: 'tester ready',
    clearWorldContext: true,
    userId: 'tester-user',
  }).map((mutation) => mutation.mutation.oneofKind).join(',');

  return {
    lifecycleStatus: snapshot.lifecycleStatus,
    presentationBackend: presentation?.backendKind ?? 'none',
    nextHookStatus: snapshot.pendingHooks[0]?.status ?? null,
    eventSummary: event.summaryText,
    mutationKinds,
  };
}
