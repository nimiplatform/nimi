import {
  HookAdmissionState,
  HookTriggerFamily,
  MemoryCanonicalClass,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import { buildRuntimeAgentRequestContext, projectRuntimeLocalAgentIdentity, type RuntimeLocalAgentIdentityInput } from './agent-local-identity';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
} from './runtime-agent-protected';
import {
  buildNimiRuntimeAgentStateMutations,
  formatNimiRuntimeAgentHookStatus,
  normalizeNimiRuntimeAgentAutonomyModeInput,
  projectNimiRuntimeAgentAutonomySnapshot,
  projectNimiRuntimeAgentInspectEventSummary,
  projectNimiRuntimeAgentInspectSnapshot,
  projectNimiRuntimeAgentPendingHookInspect,
  projectNimiRuntimeAgentStateSnapshot,
  readNimiRuntimeAgentPresentationProfile,
  toNimiRuntimeAgentAutonomyMode,
} from './runtime-agent-inspect-projection';
import type {
  NimiHostRuntimeAgentInspectClient,
  NimiHostRuntimeAgentInspectSurfaceOptions,
  NimiRuntimeAgentInspectSurface,
  NimiRuntimeAgentPendingHookInspect,
} from './runtime-agent-inspect-types';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';

export * from './runtime-agent-inspect-projection';
export * from './runtime-agent-inspect-types';
export * from './runtime-agent-proactive-projection';

const DEFAULT_MAX_PENDING_HOOK_PREVIEW = 3;
const DEFAULT_MAX_RECENT_TERMINAL_HOOKS = 6;
const DEFAULT_MAX_RECENT_CANONICAL_MEMORIES = 6;

export function normalizeNimiRuntimeAgentNonNegativeInteger(value: unknown): string {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return '0';
  }
  return String(Math.trunc(normalized));
}

function resolvePositiveLimit(value: unknown, fallback: number): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? Math.trunc(normalized) : fallback;
}

function inspectError(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}

export function createNimiHostRuntimeAgentInspectSurface(
  options: NimiHostRuntimeAgentInspectSurfaceOptions,
): NimiRuntimeAgentInspectSurface {
  const maxPendingHookPreview = resolvePositiveLimit(
    options.maxPendingHookPreview,
    DEFAULT_MAX_PENDING_HOOK_PREVIEW,
  );
  const maxRecentTerminalHooks = resolvePositiveLimit(
    options.maxRecentTerminalHooks,
    DEFAULT_MAX_RECENT_TERMINAL_HOOKS,
  );
  const maxRecentCanonicalMemories = resolvePositiveLimit(
    options.maxRecentCanonicalMemories,
    DEFAULT_MAX_RECENT_CANONICAL_MEMORIES,
  );

  async function context(identityInput: RuntimeLocalAgentIdentityInput) {
    const identity = projectRuntimeLocalAgentIdentity(identityInput);
    const runtime = options.getRuntime();
    const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
      options.getSubjectUserId,
      'Runtime Agent inspect requires authenticated subject user id.',
    );
    return {
      runtime,
      subjectUserId,
      agentId: identity.localAgentRef,
      requestContext: buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId,
        ...identity,
      }),
    };
  }

  function withScopes<T>(
    runtime: NimiHostRuntimeAgentInspectClient,
    subjectUserId: string,
    scopes: readonly string[],
    operation: (callOptions: RuntimeTypedCallOptions) => Promise<T>,
  ): Promise<T> {
    return withNimiRuntimeAgentScopes({
      runtime,
      subjectUserId,
      withScopes: options.withScopes,
    }, scopes, operation);
  }

  return {
    async cancelHook(input) {
      const resolved = await context(input);
      const cancelHook = resolved.runtime.agent.cancelHook;
      if (!cancelHook) {
        inspectError(
          'Runtime Agent inspect client does not support hook cancellation.',
          'SDK_RUNTIME_AGENT_INSPECT_METHOD_MISSING',
          'provide_runtime_agent_cancel_hook',
        );
      }
      const normalizedHookId = normalizeNimiRuntimeAgentText(input.hookId);
      if (!normalizedHookId) {
        inspectError('Runtime Agent hook id is required.', 'SDK_RUNTIME_AGENT_HOOK_ID_REQUIRED', 'provide_runtime_agent_hook_id');
      }
      const response = await withScopes(
        resolved.runtime,
        resolved.subjectUserId,
        ['runtime.agent.write'],
        (callOptions) => cancelHook({
          context: resolved.requestContext,
          agentId: resolved.agentId,
          intentId: normalizedHookId,
          reason: normalizeNimiRuntimeAgentText(input.reason),
        }, callOptions),
      );
      return {
        hookId: normalizeNimiRuntimeAgentText(response.outcome?.intent?.intentId) || normalizedHookId,
        status: formatNimiRuntimeAgentHookStatus(response.outcome?.intent?.admissionState),
      };
    },
    async disableAutonomy(input) {
      const resolved = await context(input);
      const disableAutonomy = resolved.runtime.agent.disableAutonomy;
      if (!disableAutonomy) {
        inspectError(
          'Runtime Agent inspect client does not support autonomy disable.',
          'SDK_RUNTIME_AGENT_INSPECT_METHOD_MISSING',
          'provide_runtime_agent_disable_autonomy',
        );
      }
      const response = await withScopes(
        resolved.runtime,
        resolved.subjectUserId,
        ['runtime.agent.autonomy.write'],
        (callOptions) => disableAutonomy({
          context: resolved.requestContext,
          agentId: resolved.agentId,
          reason: normalizeNimiRuntimeAgentText(input.reason),
        }, callOptions),
      );
      return projectNimiRuntimeAgentAutonomySnapshot(response.autonomy);
    },
    async enableAutonomy(input) {
      const resolved = await context(input);
      const enableAutonomy = resolved.runtime.agent.enableAutonomy;
      if (!enableAutonomy) {
        inspectError(
          'Runtime Agent inspect client does not support autonomy enable.',
          'SDK_RUNTIME_AGENT_INSPECT_METHOD_MISSING',
          'provide_runtime_agent_enable_autonomy',
        );
      }
      const response = await withScopes(
        resolved.runtime,
        resolved.subjectUserId,
        ['runtime.agent.autonomy.write'],
        (callOptions) => enableAutonomy({
          context: resolved.requestContext,
          agentId: resolved.agentId,
        }, callOptions),
      );
      return projectNimiRuntimeAgentAutonomySnapshot(response.autonomy);
    },
    async getPublicInspect(input) {
      const resolved = await context(input);
      const listHooksByStatus = async (
        admissionStateFilter: HookAdmissionState,
      ): Promise<NimiRuntimeAgentPendingHookInspect[]> => {
        let pageToken = '';
        const collected: NimiRuntimeAgentPendingHookInspect[] = [];
        do {
          const response = await withScopes(
            resolved.runtime,
            resolved.subjectUserId,
            ['runtime.agent.read'],
            (callOptions) => resolved.runtime.agent.listPendingHooks({
              context: resolved.requestContext,
              agentId: resolved.agentId,
              triggerFamilyFilter: HookTriggerFamily.UNSPECIFIED,
              admissionStateFilter,
              pageSize: 200,
              pageToken,
            }, callOptions),
          );
          collected.push(...(response.hooks || []).map(projectNimiRuntimeAgentPendingHookInspect));
          pageToken = normalizeNimiRuntimeAgentText(response.nextPageToken);
        } while (pageToken);
        return collected;
      };

      const [
        agent,
        state,
        activeHooks,
        completedHooks,
        failedHooks,
        canceledHooks,
        rescheduledHooks,
        rejectedHooks,
      ] = await Promise.all([
        withScopes(
          resolved.runtime,
          resolved.subjectUserId,
          ['runtime.agent.read'],
          (callOptions) => resolved.runtime.agent.getAgent({
            context: resolved.requestContext,
            agentId: resolved.agentId,
          }, callOptions),
        ),
        withScopes(
          resolved.runtime,
          resolved.subjectUserId,
          ['runtime.agent.read'],
          (callOptions) => resolved.runtime.agent.getAgentState({
            context: resolved.requestContext,
            agentId: resolved.agentId,
          }, callOptions),
        ),
        listHooksByStatus(HookAdmissionState.UNSPECIFIED),
        listHooksByStatus(HookAdmissionState.COMPLETED),
        listHooksByStatus(HookAdmissionState.FAILED),
        listHooksByStatus(HookAdmissionState.CANCELED),
        listHooksByStatus(HookAdmissionState.RESCHEDULED),
        listHooksByStatus(HookAdmissionState.REJECTED),
      ]);
      const stateSnapshot = projectNimiRuntimeAgentStateSnapshot(state.state);
      const canonicalClasses = [
        MemoryCanonicalClass.PUBLIC_SHARED,
        ...(stateSnapshot.activeWorldId ? [MemoryCanonicalClass.WORLD_SHARED] : []),
        ...(stateSnapshot.activeUserId ? [MemoryCanonicalClass.DYADIC] : []),
      ];
      const memories = await withScopes(
        resolved.runtime,
        resolved.subjectUserId,
        ['runtime.agent.read'],
        (callOptions) => resolved.runtime.agent.queryAgentMemory({
          context: resolved.requestContext,
          agentId: resolved.agentId,
          query: '',
          limit: maxRecentCanonicalMemories,
          canonicalClasses,
          kinds: [],
          includeInvalidated: false,
        }, callOptions),
      );
      return projectNimiRuntimeAgentInspectSnapshot({
        agent: agent.agent,
        state: state.state,
        activeHooks,
        terminalHooks: [
          ...completedHooks,
          ...failedHooks,
          ...canceledHooks,
          ...rescheduledHooks,
          ...rejectedHooks,
        ],
        recentCanonicalMemories: memories.memories || [],
        maxPendingHookPreview,
        maxRecentTerminalHooks,
      });
    },
    async getPresentationProfile(input) {
      const resolved = await context(input);
      const agent = await withScopes(
        resolved.runtime,
        resolved.subjectUserId,
        ['runtime.agent.read'],
        (callOptions) => resolved.runtime.agent.getAgent({
          context: resolved.requestContext,
          agentId: resolved.agentId,
        }, callOptions),
      );
      return readNimiRuntimeAgentPresentationProfile(agent.agent?.metadata);
    },
    async setAutonomyConfig(input) {
      const resolved = await context(input);
      const setAutonomyConfig = resolved.runtime.agent.setAutonomyConfig;
      if (!setAutonomyConfig) {
        inspectError(
          'Runtime Agent inspect client does not support autonomy config updates.',
          'SDK_RUNTIME_AGENT_INSPECT_METHOD_MISSING',
          'provide_runtime_agent_set_autonomy_config',
        );
      }
      const response = await withScopes(
        resolved.runtime,
        resolved.subjectUserId,
        ['runtime.agent.autonomy.write'],
        (callOptions) => setAutonomyConfig({
          context: resolved.requestContext,
          agentId: resolved.agentId,
          config: {
            mode: toNimiRuntimeAgentAutonomyMode(normalizeNimiRuntimeAgentAutonomyModeInput(input.mode)),
            dailyTokenBudget: normalizeNimiRuntimeAgentNonNegativeInteger(input.dailyTokenBudget),
            maxTokensPerHook: normalizeNimiRuntimeAgentNonNegativeInteger(input.maxTokensPerHook),
          },
        }, callOptions),
      );
      return projectNimiRuntimeAgentAutonomySnapshot(response.autonomy);
    },
    async subscribePublicEvents(input) {
      const resolved = await context(input);
      const subscribeAgentEvents = resolved.runtime.agent.subscribeAgentEvents;
      if (!subscribeAgentEvents) {
        inspectError(
          'Runtime Agent inspect client does not support event subscription.',
          'SDK_RUNTIME_AGENT_INSPECT_METHOD_MISSING',
          'provide_runtime_agent_subscribe_events',
        );
      }
      await withScopes(
        resolved.runtime,
        resolved.subjectUserId,
        ['runtime.agent.read'],
        async (callOptions) => {
          const stream = subscribeAgentEvents({
            context: resolved.requestContext,
            agentId: resolved.agentId,
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
            await input.onEvent(projectNimiRuntimeAgentInspectEventSummary({
              event,
              fallbackAgentId: resolved.agentId,
            }));
          }
        },
      );
    },
    async updateState(input) {
      const resolved = await context(input);
      const updateAgentState = resolved.runtime.agent.updateAgentState;
      if (!updateAgentState) {
        inspectError(
          'Runtime Agent inspect client does not support state updates.',
          'SDK_RUNTIME_AGENT_INSPECT_METHOD_MISSING',
          'provide_runtime_agent_update_state',
        );
      }
      const mutations = buildNimiRuntimeAgentStateMutations(input);
      if (mutations.length === 0) {
        inspectError(
          'Runtime Agent state update requires at least one mutation.',
          'SDK_RUNTIME_AGENT_STATE_MUTATION_REQUIRED',
          'provide_runtime_agent_state_mutation',
        );
      }
      const response = await withScopes(
        resolved.runtime,
        resolved.subjectUserId,
        ['runtime.agent.write'],
        (callOptions) => updateAgentState({
          context: resolved.requestContext,
          agentId: resolved.agentId,
          mutations,
        }, callOptions),
      );
      return projectNimiRuntimeAgentStateSnapshot(response.state);
    },
  };
}
