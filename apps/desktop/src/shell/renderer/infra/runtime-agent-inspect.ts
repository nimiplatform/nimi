import { getPlatformClient } from '@nimiplatform/sdk';
import {
  buildRuntimeAgentRequestContext,
  buildRuntimeAgentStateMutations,
  createRuntimeProtectedScopeHelper,
  formatRuntimeAgentHookStatus,
  HookAdmissionState,
  HookTriggerFamily,
  MemoryCanonicalClass,
  normalizeRuntimeAgentAutonomyModeInput,
  normalizeRuntimeAgentError,
  normalizeRuntimeAgentNonNegativeInteger,
  normalizeRuntimeAgentText,
  projectRuntimeAgentAutonomySnapshot,
  projectRuntimeAgentInspectEventSummary,
  projectRuntimeAgentInspectSnapshot,
  projectRuntimeAgentPendingHookInspect,
  projectRuntimeAgentStateSnapshot,
  readRuntimeAgentPresentationProfile,
  toRuntimeAgentAutonomyMode,
  type RuntimeAgentAutonomyMode,
  type RuntimeAgentAutonomySnapshot,
  type RuntimeAgentCanonicalMemoryInspect,
  type RuntimeAgentInspectEventSummary,
  type RuntimeAgentInspectSnapshot,
  type RuntimeAgentPendingHookInspect,
  type RuntimeAgentStateSnapshot,
} from '@nimiplatform/sdk/runtime';
import type { AvatarPresentationProfile } from '@nimiplatform/kit/features/avatar/headless';

export type {
  RuntimeAgentCanonicalMemoryInspect,
  RuntimeAgentInspectEventSummary,
  RuntimeAgentPendingHookInspect,
  RuntimeAgentInspectSnapshot,
  RuntimeAgentAutonomySnapshot,
  RuntimeAgentStateSnapshot,
} from '@nimiplatform/sdk/runtime';

const MAX_PENDING_HOOK_PREVIEW = 3;
const MAX_RECENT_TERMINAL_HOOKS = 6;
const MAX_RECENT_CANONICAL_MEMORIES = 6;

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];

type RuntimeAgentInspectDeps = {
  getRuntime?: () => RuntimeClient;
  getSubjectUserId?: () => string | undefined | Promise<string | undefined>;
};

export function createRuntimeAgentInspectAdapter(deps: RuntimeAgentInspectDeps = {}) {
  const getRuntime = deps.getRuntime ?? (() => getPlatformClient().runtime);
  let protectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

  const resolveSubjectUserId = async (): Promise<string> => {
    const subjectUserId = normalizeRuntimeAgentText(await deps.getSubjectUserId?.());
    if (!subjectUserId) {
      throw new Error('desktop runtime agent inspect requires authenticated subject user id');
    }
    return subjectUserId;
  };

  const getProtectedAccess = () => {
    if (protectedAccess) {
      return protectedAccess;
    }
    protectedAccess = createRuntimeProtectedScopeHelper({
      runtime: getRuntime(),
      getSubjectUserId: async () => resolveSubjectUserId(),
    });
    return protectedAccess;
  };

  const getPublicInspect = async (agentId: string): Promise<RuntimeAgentInspectSnapshot> => {
    const normalizedAgentId = normalizeRuntimeAgentText(agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = buildRuntimeAgentRequestContext({
      runtimeAppId: runtime.appId,
      subjectUserId,
      localAgentRef: normalizedAgentId,
    });
    const listHooksByStatus = async (admissionStateFilter: HookAdmissionState): Promise<RuntimeAgentPendingHookInspect[]> => {
      let pageToken = '';
      const collected: RuntimeAgentPendingHookInspect[] = [];
      do {
        const response = await protectedScopes.withScopes(['runtime.agent.read'], (options) => runtime.agent.listPendingHooks({
          context,
          agentId: normalizedAgentId,
          triggerFamilyFilter: HookTriggerFamily.UNSPECIFIED,
          admissionStateFilter,
          pageSize: 200,
          pageToken,
        }, options));
        collected.push(...(response.hooks || []).map(projectRuntimeAgentPendingHookInspect));
        pageToken = String(response.nextPageToken || '').trim();
      } while (pageToken);
      return collected;
    };

    try {
      const [
        agentResponse,
        stateResponse,
        activeHooks,
        completedHooks,
        failedHooks,
        canceledHooks,
        rescheduledHooks,
        rejectedHooks,
      ] = await Promise.all([
        protectedScopes.withScopes(['runtime.agent.read'], (options) => runtime.agent.getAgent({
          context,
          agentId: normalizedAgentId,
        }, options)),
        protectedScopes.withScopes(['runtime.agent.read'], (options) => runtime.agent.getAgentState({
          context,
          agentId: normalizedAgentId,
        }, options)),
        listHooksByStatus(HookAdmissionState.UNSPECIFIED),
        listHooksByStatus(HookAdmissionState.COMPLETED),
        listHooksByStatus(HookAdmissionState.FAILED),
        listHooksByStatus(HookAdmissionState.CANCELED),
        listHooksByStatus(HookAdmissionState.RESCHEDULED),
        listHooksByStatus(HookAdmissionState.REJECTED),
      ]);
      const activeWorldId = normalizeRuntimeAgentText(stateResponse.state?.activeWorldId);
      const activeUserId = normalizeRuntimeAgentText(stateResponse.state?.activeUserId);
      const canonicalClasses = [
        MemoryCanonicalClass.PUBLIC_SHARED,
        ...(activeWorldId ? [MemoryCanonicalClass.WORLD_SHARED] : []),
        ...(activeUserId ? [MemoryCanonicalClass.DYADIC] : []),
      ];
      const recentCanonicalMemoriesResponse = await protectedScopes.withScopes(['runtime.agent.read'], (options) => runtime.agent.queryMemory({
        context,
        agentId: normalizedAgentId,
        query: '',
        limit: MAX_RECENT_CANONICAL_MEMORIES,
        canonicalClasses,
        kinds: [],
        includeInvalidated: false,
      }, options));
      const terminalHooks = [
        ...completedHooks,
        ...failedHooks,
        ...canceledHooks,
        ...rescheduledHooks,
        ...rejectedHooks,
      ];
      return projectRuntimeAgentInspectSnapshot({
        agent: agentResponse.agent,
        state: stateResponse.state,
        activeHooks,
        terminalHooks,
        recentCanonicalMemories: recentCanonicalMemoriesResponse.memories || [],
        maxPendingHookPreview: MAX_PENDING_HOOK_PREVIEW,
        maxRecentTerminalHooks: MAX_RECENT_TERMINAL_HOOKS,
      });
    } catch (error) {
      throw normalizeRuntimeAgentError(error, 'inspect_runtime_agent');
    }
  };

  const getPresentationProfile = async (agentId: string): Promise<AvatarPresentationProfile | null> => {
    const normalizedAgentId = normalizeRuntimeAgentText(agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = buildRuntimeAgentRequestContext({
      runtimeAppId: runtime.appId,
      subjectUserId,
      localAgentRef: normalizedAgentId,
    });
    try {
      const response = await protectedScopes.withScopes(['runtime.agent.read'], (options) => runtime.agent.getAgent({
        context,
        agentId: normalizedAgentId,
      }, options));
      return readRuntimeAgentPresentationProfile(response.agent?.metadata);
    } catch (error) {
      throw normalizeRuntimeAgentError(error, 'inspect_runtime_agent_presentation');
    }
  };

  const enableAutonomy = async (agentId: string): Promise<RuntimeAgentAutonomySnapshot> => {
    const normalizedAgentId = normalizeRuntimeAgentText(agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = buildRuntimeAgentRequestContext({
      runtimeAppId: runtime.appId,
      subjectUserId,
      localAgentRef: normalizedAgentId,
    });
    try {
      const response = await protectedScopes.withScopes(['runtime.agent.autonomy.write'], (options) => (
        runtime.agent.enableAutonomy({
          context,
          agentId: normalizedAgentId,
        }, options)
      ));
      return projectRuntimeAgentAutonomySnapshot(response.autonomy);
    } catch (error) {
      throw normalizeRuntimeAgentError(error, 'enable_runtime_agent_autonomy');
    }
  };

  const updateState = async (input: {
    agentId: string;
    statusText?: string | null;
    worldId?: string | null;
    clearWorldContext?: boolean;
    userId?: string | null;
    clearDyadicContext?: boolean;
  }): Promise<RuntimeAgentStateSnapshot> => {
    const normalizedAgentId = normalizeRuntimeAgentText(input.agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    const mutations = buildRuntimeAgentStateMutations(input);
    if (mutations.length === 0) {
      throw new Error('STATE_MUTATION_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = buildRuntimeAgentRequestContext({
      runtimeAppId: runtime.appId,
      subjectUserId,
      localAgentRef: normalizedAgentId,
    });
    try {
      const response = await protectedScopes.withScopes(['runtime.agent.write'], (options) => (
        runtime.agent.updateAgentState({
          context,
          agentId: normalizedAgentId,
          mutations,
        }, options)
      ));
      return projectRuntimeAgentStateSnapshot(response.state);
    } catch (error) {
      throw normalizeRuntimeAgentError(error, 'update_runtime_agent_state');
    }
  };

  const disableAutonomy = async (input: {
    agentId: string;
    reason: string;
  }): Promise<RuntimeAgentAutonomySnapshot> => {
    const normalizedAgentId = normalizeRuntimeAgentText(input.agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = buildRuntimeAgentRequestContext({
      runtimeAppId: runtime.appId,
      subjectUserId,
      localAgentRef: normalizedAgentId,
    });
    try {
      const response = await protectedScopes.withScopes(['runtime.agent.autonomy.write'], (options) => (
        runtime.agent.disableAutonomy({
          context,
          agentId: normalizedAgentId,
          reason: normalizeRuntimeAgentText(input.reason),
        }, options)
      ));
      return projectRuntimeAgentAutonomySnapshot(response.autonomy);
    } catch (error) {
      throw normalizeRuntimeAgentError(error, 'disable_runtime_agent_autonomy');
    }
  };

  const cancelHook = async (input: {
    agentId: string;
    hookId: string;
    reason: string;
  }): Promise<{ hookId: string; status: string | null }> => {
    const normalizedAgentId = normalizeRuntimeAgentText(input.agentId);
    const normalizedHookId = normalizeRuntimeAgentText(input.hookId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    if (!normalizedHookId) {
      throw new Error('HOOK_ID_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = buildRuntimeAgentRequestContext({
      runtimeAppId: runtime.appId,
      subjectUserId,
      localAgentRef: normalizedAgentId,
    });
    try {
      const response = await protectedScopes.withScopes(['runtime.agent.write'], (options) => (
        runtime.agent.cancelHook({
          context,
          agentId: normalizedAgentId,
          intentId: normalizedHookId,
          reason: normalizeRuntimeAgentText(input.reason),
        }, options)
      ));
      return {
        hookId: normalizeRuntimeAgentText(response.outcome?.intent?.intentId) || normalizedHookId,
        status: formatRuntimeAgentHookStatus(response.outcome?.intent?.admissionState),
      };
    } catch (error) {
      throw normalizeRuntimeAgentError(error, 'cancel_runtime_agent_hook');
    }
  };

  const setAutonomyConfig = async (input: {
    agentId: string;
    mode: RuntimeAgentAutonomyMode | string;
    dailyTokenBudget: string | number;
    maxTokensPerHook: string | number;
  }): Promise<RuntimeAgentAutonomySnapshot> => {
    const normalizedAgentId = normalizeRuntimeAgentText(input.agentId);
    const normalizedMode = normalizeRuntimeAgentAutonomyModeInput(input.mode);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = buildRuntimeAgentRequestContext({
      runtimeAppId: runtime.appId,
      subjectUserId,
      localAgentRef: normalizedAgentId,
    });
    try {
      const response = await protectedScopes.withScopes(['runtime.agent.autonomy.write'], (options) => (
        runtime.agent.setAutonomyConfig({
          context,
          agentId: normalizedAgentId,
          config: {
            mode: toRuntimeAgentAutonomyMode(normalizedMode),
            dailyTokenBudget: normalizeRuntimeAgentNonNegativeInteger(input.dailyTokenBudget),
            maxTokensPerHook: normalizeRuntimeAgentNonNegativeInteger(input.maxTokensPerHook),
          },
        }, options)
      ));
      return projectRuntimeAgentAutonomySnapshot(response.autonomy);
    } catch (error) {
      throw normalizeRuntimeAgentError(error, 'set_runtime_agent_autonomy_config');
    }
  };

  const subscribePublicEvents = async (input: {
    agentId: string;
    signal?: AbortSignal;
    onEvent: (event: RuntimeAgentInspectEventSummary) => void | Promise<void>;
  }): Promise<void> => {
    const normalizedAgentId = normalizeRuntimeAgentText(input.agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = buildRuntimeAgentRequestContext({
      runtimeAppId: runtime.appId,
      subjectUserId,
      localAgentRef: normalizedAgentId,
    });
    try {
      const callOptions = await protectedScopes.getCallOptions(['runtime.agent.read']);
      const stream = await runtime.agent.subscribeEvents({
        context,
        agentId: normalizedAgentId,
        cursor: '',
        eventFilters: [],
      }, {
        ...callOptions,
        signal: input.signal,
      });
      for await (const event of stream) {
        if (input.signal?.aborted) {
          break;
        }
        await input.onEvent(projectRuntimeAgentInspectEventSummary({
          event,
          fallbackAgentId: normalizedAgentId,
        }));
      }
    } catch (error) {
      if (input.signal?.aborted) {
        return;
      }
      throw normalizeRuntimeAgentError(error, 'subscribe_runtime_agent_events');
    }
  };

  return {
    cancelHook,
    disableAutonomy,
    enableAutonomy,
    getPresentationProfile,
    getPublicInspect,
    setAutonomyConfig,
    subscribePublicEvents,
    updateState,
  };
}
