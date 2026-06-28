import { buildNimiRuntimeAgentStateMutations, createNimiHostRuntimeAgentInspectSurface, projectNimiRuntimeAgentInspectSnapshot, projectNimiRuntimeAgentPendingHookInspect, readNimiRuntimeAgentPresentationProfile, toNimiRuntimeProtoStruct } from '@nimiplatform/sdk/runtime';
import { AgentAutonomyMode, AgentExecutionState, AgentLifecycleStatus, HookAdmissionState, HookTriggerFamily } from '@nimiplatform/sdk/runtime/generated';

export type TesterRuntimeAgentInspectProjection = {
  lifecycleStatus: string | null;
  presentationBackend: string;
  nextHookStatus: string | null;
  mutationKinds: string;
};

export function createTesterRuntimeAgentInspectSurface() {
  return createNimiHostRuntimeAgentInspectSurface({
    getRuntime: () => ({
      appId: 'nimi.tester',
      auth: {
        async registerApp() {
          return { accepted: true };
        },
      },
      appAuth: {
        async authorizeExternalPrincipal() {
          return { tokenId: 'tester-token', secret: 'tester-secret' };
        },
      },
      agent: {
        async getAgent() {
          return {
            agent: {
              lifecycleStatus: AgentLifecycleStatus.ACTIVE,
              metadata: toNimiRuntimeProtoStruct({
                presentationProfile: {
                  backendKind: 'vrm',
                  avatarAssetRef: 'asset://tester/vrm-agent',
                },
              }),
            },
          };
        },
        async getAgentState() {
          return {
            state: {
              executionState: AgentExecutionState.IDLE,
              statusText: 'tester ready',
              activeWorldId: '',
              activeUserId: 'tester-user',
            },
          };
        },
        async listPendingHooks() {
          return { hooks: [], nextPageToken: '' };
        },
        async queryAgentMemory() {
          return { memories: [] };
        },
        async updateAgentState() {
          return { state: { executionState: AgentExecutionState.IDLE, statusText: 'updated' } };
        },
        async enableAutonomy() {
          return { autonomy: { enabled: true, config: { mode: AgentAutonomyMode.LOW } } };
        },
        async disableAutonomy() {
          return { autonomy: { enabled: false, config: { mode: AgentAutonomyMode.OFF } } };
        },
        async setAutonomyConfig(input: { config?: { mode?: AgentAutonomyMode } }) {
          return { autonomy: { enabled: true, config: { mode: input.config?.mode } } };
        },
        async cancelHook(input: { intentId?: string }) {
          return {
            outcome: {
              intent: {
                intentId: input.intentId || 'tester-hook',
                admissionState: HookAdmissionState.CANCELED,
              },
            },
          };
        },
        async subscribeEvents() {
          async function* stream() {}
          return stream();
        },
      },
    }) as never,
    getSubjectUserId: () => 'tester-user',
  });
}

export async function inspectTesterRuntimeAgentSurfaceProjection(): Promise<{
  lifecycleStatus: string | null;
  presentationBackend: string;
  stateStatusText: string | null;
}> {
  const surface = createTesterRuntimeAgentInspectSurface();
  const runtimeIdentity = {
    ownerUserId: 'tester-user',
    runtimeSourceRef: 'runtime-source:tester-agent',
    localAgentRef: 'local-agent:tester-user:tester-agent',
  };
  const snapshot = await surface.getPublicInspect(runtimeIdentity);
  const presentation = await surface.getPresentationProfile(runtimeIdentity);
  return {
    lifecycleStatus: snapshot.lifecycleStatus,
    presentationBackend: presentation?.backendKind ?? 'none',
    stateStatusText: snapshot.statusText,
  };
}

export function createTesterRuntimeAgentInspectProjection(): TesterRuntimeAgentInspectProjection {
  const metadata = toNimiRuntimeProtoStruct({
    presentationProfile: {
      backendKind: 'vrm',
      avatarAssetRef: 'asset://tester/vrm-agent',
    },
  });
  const presentation = readNimiRuntimeAgentPresentationProfile(metadata);
  const pendingHook = projectNimiRuntimeAgentPendingHookInspect({
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
  const snapshot = projectNimiRuntimeAgentInspectSnapshot({
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
  const mutationKinds = buildNimiRuntimeAgentStateMutations({
    statusText: 'tester ready',
    clearWorldContext: true,
    userId: 'tester-user',
  }).map((mutation) => mutation.mutation.oneofKind).join(',');

  return {
    lifecycleStatus: snapshot.lifecycleStatus,
    presentationBackend: presentation?.backendKind ?? 'none',
    nextHookStatus: snapshot.pendingHooks[0]?.status ?? null,
    mutationKinds,
  };
}
