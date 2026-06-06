import {
  HookAdmissionState,
  HookTriggerFamily,
} from './generated/runtime/v1/agent_service.js';
import { MemoryCanonicalClass } from './generated/runtime/v1/memory.js';
import { buildRuntimeAgentRequestContext } from './local-agent-identity.js';
import {
  createRuntimeProtectedScopeHelper,
  type RuntimeProtectedScopeHelper,
  type RuntimeProtectedScopeRuntime,
} from './protected-access.js';
import {
  buildRuntimeAgentStateMutations,
  formatRuntimeAgentHookStatus,
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
  type RuntimeAgentInspectEventSummary,
  type RuntimeAgentInspectSnapshot,
  type RuntimeAgentPendingHookInspect,
  type RuntimeAgentPresentationProfileProjection,
  type RuntimeAgentStateSnapshot,
} from './runtime-agent-inspect-projection.js';
import type { RuntimeCallOptions, RuntimeStreamCallOptions } from './types.js';
import type { RuntimeAgentClient } from './types-client-interfaces.js';

const DEFAULT_MAX_PENDING_HOOK_PREVIEW = 3;
const DEFAULT_MAX_RECENT_TERMINAL_HOOKS = 6;
const DEFAULT_MAX_RECENT_CANONICAL_MEMORIES = 6;

type ProtectedRuntimeAgentInspectRuntime =
  RuntimeProtectedScopeRuntime
  & {
    readonly agent: Pick<
      RuntimeAgentClient,
      | 'getAgent'
      | 'getAgentState'
      | 'updateAgentState'
      | 'listPendingHooks'
      | 'queryMemory'
      | 'enableAutonomy'
      | 'disableAutonomy'
      | 'setAutonomyConfig'
      | 'cancelHook'
      | 'subscribeEvents'
    >;
  };

export type RuntimeAgentInspectSurface = {
  cancelHook(input: { agentId: string; hookId: string; reason: string }): Promise<{
    hookId: string;
    status: string | null;
  }>;
  disableAutonomy(input: {
    agentId: string;
    reason: string;
  }): Promise<RuntimeAgentAutonomySnapshot>;
  enableAutonomy(agentId: string): Promise<RuntimeAgentAutonomySnapshot>;
  getPresentationProfile(agentId: string): Promise<RuntimeAgentPresentationProfileProjection | null>;
  getPublicInspect(agentId: string): Promise<RuntimeAgentInspectSnapshot>;
  setAutonomyConfig(input: {
    agentId: string;
    mode: RuntimeAgentAutonomyMode | string;
    dailyTokenBudget: string | number;
    maxTokensPerHook: string | number;
  }): Promise<RuntimeAgentAutonomySnapshot>;
  subscribePublicEvents(input: {
    agentId: string;
    signal?: AbortSignal;
    onEvent: (event: RuntimeAgentInspectEventSummary) => void | Promise<void>;
  }): Promise<void>;
  updateState(input: {
    agentId: string;
    statusText?: string | null;
    worldId?: string | null;
    clearWorldContext?: boolean;
    userId?: string | null;
    clearDyadicContext?: boolean;
  }): Promise<RuntimeAgentStateSnapshot>;
};

export type HostRuntimeAgentInspectSurfaceOptions = {
  readonly getRuntime: () => ProtectedRuntimeAgentInspectRuntime;
  readonly getSubjectUserId: () => string | undefined | Promise<string | undefined>;
  readonly createProtectedScopeHelper?: (
    runtime: ProtectedRuntimeAgentInspectRuntime,
    getSubjectUserId: () => Promise<string>,
  ) => RuntimeProtectedScopeHelper;
  readonly maxPendingHookPreview?: number;
  readonly maxRecentTerminalHooks?: number;
  readonly maxRecentCanonicalMemories?: number;
};

function resolveLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.trunc(Number(value)) : fallback;
}

function requireAgentId(agentId: string): string {
  const normalizedAgentId = normalizeRuntimeAgentText(agentId);
  if (!normalizedAgentId) {
    throw new Error('AGENT_ID_REQUIRED');
  }
  return normalizedAgentId;
}

async function resolveSubjectUserId(
  getSubjectUserId: HostRuntimeAgentInspectSurfaceOptions['getSubjectUserId'],
): Promise<string> {
  const subjectUserId = normalizeRuntimeAgentText(await getSubjectUserId());
  if (!subjectUserId) {
    throw new Error('runtime agent inspect requires authenticated subject user id');
  }
  return subjectUserId;
}

function defaultCreateProtectedScopeHelper(
  runtime: ProtectedRuntimeAgentInspectRuntime,
  getSubjectUserId: () => Promise<string>,
): RuntimeProtectedScopeHelper {
  return createRuntimeProtectedScopeHelper({
    runtime,
    getSubjectUserId,
  });
}

export function createHostRuntimeAgentInspectSurface(
  options: HostRuntimeAgentInspectSurfaceOptions,
): RuntimeAgentInspectSurface {
  const createProtectedScopeHelper =
    options.createProtectedScopeHelper ?? defaultCreateProtectedScopeHelper;
  const maxPendingHookPreview = resolveLimit(
    options.maxPendingHookPreview,
    DEFAULT_MAX_PENDING_HOOK_PREVIEW,
  );
  const maxRecentTerminalHooks = resolveLimit(
    options.maxRecentTerminalHooks,
    DEFAULT_MAX_RECENT_TERMINAL_HOOKS,
  );
  const maxRecentCanonicalMemories = resolveLimit(
    options.maxRecentCanonicalMemories,
    DEFAULT_MAX_RECENT_CANONICAL_MEMORIES,
  );
  let protectedAccess: RuntimeProtectedScopeHelper | null = null;

  const getRuntime = () => options.getRuntime();
  const getSubject = () => resolveSubjectUserId(options.getSubjectUserId);
  const getProtectedAccess = () => {
    if (protectedAccess) {
      return protectedAccess;
    }
    protectedAccess = createProtectedScopeHelper(getRuntime(), getSubject);
    return protectedAccess;
  };
  const buildContext = async (agentId: string) => {
    const runtime = getRuntime();
    const subjectUserId = await getSubject();
    return {
      runtime,
      protectedScopes: getProtectedAccess(),
      context: buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId,
        localAgentRef: agentId,
      }),
    };
  };
  const withRuntimeAgentScopes = <T>(
    scopes: readonly string[],
    operation: (options: RuntimeCallOptions) => Promise<T>,
  ): Promise<T> => getProtectedAccess().withScopes(scopes, operation);

  return {
    async getPublicInspect(agentId: string): Promise<RuntimeAgentInspectSnapshot> {
      const normalizedAgentId = requireAgentId(agentId);
      const { runtime, context } = await buildContext(normalizedAgentId);
      const listHooksByStatus = async (
        admissionStateFilter: HookAdmissionState,
      ): Promise<RuntimeAgentPendingHookInspect[]> => {
        let pageToken = '';
        const collected: RuntimeAgentPendingHookInspect[] = [];
        do {
          const response = await withRuntimeAgentScopes(['runtime.agent.read'], (callOptions) =>
            runtime.agent.listPendingHooks({
              context,
              agentId: normalizedAgentId,
              triggerFamilyFilter: HookTriggerFamily.UNSPECIFIED,
              admissionStateFilter,
              pageSize: 200,
              pageToken,
            }, callOptions));
          collected.push(...(response.hooks || []).map(projectRuntimeAgentPendingHookInspect));
          pageToken = normalizeRuntimeAgentText(response.nextPageToken);
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
          withRuntimeAgentScopes(['runtime.agent.read'], (callOptions) => runtime.agent.getAgent({
            context,
            agentId: normalizedAgentId,
          }, callOptions)),
          withRuntimeAgentScopes(['runtime.agent.read'], (callOptions) => runtime.agent.getAgentState({
            context,
            agentId: normalizedAgentId,
          }, callOptions)),
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
        const recentCanonicalMemoriesResponse = await withRuntimeAgentScopes(
          ['runtime.agent.read'],
          (callOptions) => runtime.agent.queryMemory({
            context,
            agentId: normalizedAgentId,
            query: '',
            limit: maxRecentCanonicalMemories,
            canonicalClasses,
            kinds: [],
            includeInvalidated: false,
          }, callOptions),
        );
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
          maxPendingHookPreview,
          maxRecentTerminalHooks,
        });
      } catch (error) {
        throw normalizeRuntimeAgentError(error, 'inspect_runtime_agent');
      }
    },

    async getPresentationProfile(
      agentId: string,
    ): Promise<RuntimeAgentPresentationProfileProjection | null> {
      const normalizedAgentId = requireAgentId(agentId);
      const { runtime, context } = await buildContext(normalizedAgentId);
      try {
        const response = await withRuntimeAgentScopes(['runtime.agent.read'], (callOptions) =>
          runtime.agent.getAgent({
            context,
            agentId: normalizedAgentId,
          }, callOptions));
        return readRuntimeAgentPresentationProfile(response.agent?.metadata);
      } catch (error) {
        throw normalizeRuntimeAgentError(error, 'inspect_runtime_agent_presentation');
      }
    },

    async enableAutonomy(agentId: string): Promise<RuntimeAgentAutonomySnapshot> {
      const normalizedAgentId = requireAgentId(agentId);
      const { runtime, context } = await buildContext(normalizedAgentId);
      try {
        const response = await withRuntimeAgentScopes(['runtime.agent.autonomy.write'], (callOptions) =>
          runtime.agent.enableAutonomy({
            context,
            agentId: normalizedAgentId,
          }, callOptions));
        return projectRuntimeAgentAutonomySnapshot(response.autonomy);
      } catch (error) {
        throw normalizeRuntimeAgentError(error, 'enable_runtime_agent_autonomy');
      }
    },

    async updateState(input): Promise<RuntimeAgentStateSnapshot> {
      const normalizedAgentId = requireAgentId(input.agentId);
      const mutations = buildRuntimeAgentStateMutations(input);
      if (mutations.length === 0) {
        throw new Error('STATE_MUTATION_REQUIRED');
      }
      const { runtime, context } = await buildContext(normalizedAgentId);
      try {
        const response = await withRuntimeAgentScopes(['runtime.agent.write'], (callOptions) =>
          runtime.agent.updateAgentState({
            context,
            agentId: normalizedAgentId,
            mutations,
          }, callOptions));
        return projectRuntimeAgentStateSnapshot(response.state);
      } catch (error) {
        throw normalizeRuntimeAgentError(error, 'update_runtime_agent_state');
      }
    },

    async disableAutonomy(input): Promise<RuntimeAgentAutonomySnapshot> {
      const normalizedAgentId = requireAgentId(input.agentId);
      const { runtime, context } = await buildContext(normalizedAgentId);
      try {
        const response = await withRuntimeAgentScopes(['runtime.agent.autonomy.write'], (callOptions) =>
          runtime.agent.disableAutonomy({
            context,
            agentId: normalizedAgentId,
            reason: normalizeRuntimeAgentText(input.reason),
          }, callOptions));
        return projectRuntimeAgentAutonomySnapshot(response.autonomy);
      } catch (error) {
        throw normalizeRuntimeAgentError(error, 'disable_runtime_agent_autonomy');
      }
    },

    async cancelHook(input): Promise<{ hookId: string; status: string | null }> {
      const normalizedAgentId = requireAgentId(input.agentId);
      const normalizedHookId = normalizeRuntimeAgentText(input.hookId);
      if (!normalizedHookId) {
        throw new Error('HOOK_ID_REQUIRED');
      }
      const { runtime, context } = await buildContext(normalizedAgentId);
      try {
        const response = await withRuntimeAgentScopes(['runtime.agent.write'], (callOptions) =>
          runtime.agent.cancelHook({
            context,
            agentId: normalizedAgentId,
            intentId: normalizedHookId,
            reason: normalizeRuntimeAgentText(input.reason),
          }, callOptions));
        return {
          hookId: normalizeRuntimeAgentText(response.outcome?.intent?.intentId) || normalizedHookId,
          status: formatRuntimeAgentHookStatus(response.outcome?.intent?.admissionState),
        };
      } catch (error) {
        throw normalizeRuntimeAgentError(error, 'cancel_runtime_agent_hook');
      }
    },

    async setAutonomyConfig(input): Promise<RuntimeAgentAutonomySnapshot> {
      const normalizedAgentId = requireAgentId(input.agentId);
      const normalizedMode = normalizeRuntimeAgentAutonomyModeInput(input.mode);
      const { runtime, context } = await buildContext(normalizedAgentId);
      try {
        const response = await withRuntimeAgentScopes(['runtime.agent.autonomy.write'], (callOptions) =>
          runtime.agent.setAutonomyConfig({
            context,
            agentId: normalizedAgentId,
            config: {
              mode: toRuntimeAgentAutonomyMode(normalizedMode),
              dailyTokenBudget: normalizeRuntimeAgentNonNegativeInteger(input.dailyTokenBudget),
              maxTokensPerHook: normalizeRuntimeAgentNonNegativeInteger(input.maxTokensPerHook),
            },
          }, callOptions));
        return projectRuntimeAgentAutonomySnapshot(response.autonomy);
      } catch (error) {
        throw normalizeRuntimeAgentError(error, 'set_runtime_agent_autonomy_config');
      }
    },

    async subscribePublicEvents(input): Promise<void> {
      const normalizedAgentId = requireAgentId(input.agentId);
      const { runtime, context, protectedScopes } = await buildContext(normalizedAgentId);
      try {
        const callOptions = await protectedScopes.getCallOptions<RuntimeStreamCallOptions>(
          ['runtime.agent.read'],
          { signal: input.signal },
        );
        const stream = await runtime.agent.subscribeEvents({
          context,
          agentId: normalizedAgentId,
          cursor: '',
          eventFilters: [],
        }, callOptions);
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
    },
  };
}
