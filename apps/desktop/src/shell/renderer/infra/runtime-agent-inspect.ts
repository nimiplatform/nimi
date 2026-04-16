import { getPlatformClient } from '@nimiplatform/sdk';
import {
  asNimiError,
  type AgentStateMutation,
  createRuntimeProtectedScopeHelper,
  MemoryCanonicalClass,
} from '@nimiplatform/sdk/runtime';
import type { AvatarPresentationProfile } from '@nimiplatform/nimi-kit/features/avatar/headless';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { summarizeCanonicalMemoryView } from './runtime-agent-memory';

export type RuntimeAgentPendingHookInspect = {
  hookId: string;
  status: string | null;
  triggerKind: string | null;
  scheduledFor: string | null;
  admittedAt?: string | null;
};

export type RuntimeAgentInspectSnapshot = {
  lifecycleStatus: string | null;
  presentationProfile?: AvatarPresentationProfile | null;
  executionState: string | null;
  statusText: string | null;
  activeWorldId: string | null;
  activeUserId: string | null;
  autonomyEnabled: boolean | null;
  autonomyBudgetExhausted: boolean | null;
  autonomyUsedTokensInWindow: number | null;
  autonomyDailyTokenBudget: number | null;
  autonomyMaxTokensPerHook: number | null;
  autonomyWindowStartedAt: string | null;
  autonomySuspendedUntil: string | null;
  pendingHooksCount: number;
  nextScheduledFor: string | null;
  pendingHooks: readonly RuntimeAgentPendingHookInspect[];
  recentTerminalHooks: readonly RuntimeAgentPendingHookInspect[];
  recentCanonicalMemories: readonly RuntimeAgentCanonicalMemoryInspect[];
};

export type RuntimeAgentAutonomySnapshot = {
  enabled: boolean | null;
  budgetExhausted: boolean | null;
  usedTokensInWindow: number | null;
  dailyTokenBudget: number | null;
  maxTokensPerHook: number | null;
  windowStartedAt: string | null;
  suspendedUntil: string | null;
};

export type RuntimeAgentStateSnapshot = {
  executionState: string | null;
  statusText: string | null;
  activeWorldId: string | null;
  activeUserId: string | null;
};

export type RuntimeAgentInspectEventSummary = {
  agentId: string;
  eventType: number;
  eventTypeLabel: string | null;
  sequence: string;
  detailKind: string | null;
  timestamp: string | null;
  summaryText: string | null;
  hookId: string | null;
  hookStatus: string | null;
  lifecycleStatus: string | null;
  budgetExhausted: boolean | null;
  remainingTokens: number | null;
};

export type RuntimeAgentCanonicalMemoryInspect = {
  memoryId: string;
  canonicalClass: string | null;
  kind: string | null;
  summary: string;
  updatedAt: string | null;
  sourceEventId: string | null;
  policyReason: string | null;
  recallScore: number | null;
};

const MAX_PENDING_HOOK_PREVIEW = 3;
const MAX_RECENT_TERMINAL_HOOKS = 6;
const MAX_RECENT_CANONICAL_MEMORIES = 6;

function normalizeNonNegativeInteger(value: unknown): string {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return '0';
  }
  return String(Math.trunc(normalized));
}

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];

type RuntimeAgentInspectDeps = {
  getRuntime?: () => RuntimeClient;
  getSubjectUserId?: () => string | undefined | Promise<string | undefined>;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRuntimeError(error: unknown, actionHint: string) {
  return asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint,
    source: 'runtime',
  });
}

function timestampToIso(timestamp?: { seconds: string; nanos: number }): string | null {
  if (!timestamp) {
    return null;
  }
  const seconds = Number(timestamp.seconds);
  const nanos = Number(timestamp.nanos);
  if (!Number.isFinite(seconds)) {
    return null;
  }
  const millis = seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

type ProtoStructLike = {
  fields?: Record<string, ProtoValueLike>;
};

type ProtoValueLike = {
  kind?: {
    oneofKind?: 'nullValue' | 'numberValue' | 'stringValue' | 'boolValue' | 'structValue' | 'listValue';
    nullValue?: number;
    numberValue?: number;
    stringValue?: string;
    boolValue?: boolean;
    structValue?: ProtoStructLike;
    listValue?: {
      values?: ProtoValueLike[];
    };
  };
};

function protoValueToJson(value?: ProtoValueLike): unknown {
  switch (value?.kind?.oneofKind) {
    case 'boolValue':
      return value.kind.boolValue ?? false;
    case 'numberValue':
      return value.kind.numberValue ?? 0;
    case 'stringValue':
      return value.kind.stringValue ?? '';
    case 'structValue':
      return protoStructToJson(value.kind.structValue);
    case 'listValue':
      return (value.kind.listValue?.values || []).map((item) => protoValueToJson(item));
    default:
      return null;
  }
}

function protoStructToJson(value?: ProtoStructLike): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value?.fields || {})) {
    output[key] = protoValueToJson(item);
  }
  return output;
}

function parseAvatarBackendKind(value: unknown): AvatarPresentationProfile['backendKind'] | null {
  const normalized = normalizeText(value);
  if (
    normalized === 'vrm'
    || normalized === 'sprite2d'
    || normalized === 'canvas2d'
    || normalized === 'video'
  ) {
    return normalized;
  }
  return null;
}

function parseAvatarPresentationProfile(value: unknown): AvatarPresentationProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const backendKind = parseAvatarBackendKind(record.backendKind);
  const avatarAssetRef = normalizeText(record.avatarAssetRef);
  if (!backendKind || !avatarAssetRef) {
    return null;
  }
  return {
    backendKind,
    avatarAssetRef,
    expressionProfileRef: normalizeText(record.expressionProfileRef) || null,
    idlePreset: normalizeText(record.idlePreset) || null,
    interactionPolicyRef: normalizeText(record.interactionPolicyRef) || null,
    defaultVoiceReference: normalizeText(record.defaultVoiceReference) || null,
  };
}

function readAgentPresentationProfile(metadata?: ProtoStructLike): AvatarPresentationProfile | null {
  const json = protoStructToJson(metadata);
  return parseAvatarPresentationProfile(json.presentationProfile);
}

function formatLifecycleStatus(value: unknown): string | null {
  switch (Number(value)) {
    case 1:
      return 'initializing';
    case 2:
      return 'active';
    case 3:
      return 'suspended';
    case 4:
      return 'terminating';
    case 5:
      return 'terminated';
    default:
      return null;
  }
}

function formatExecutionState(value: unknown): string | null {
  switch (Number(value)) {
    case 1:
      return 'idle';
    case 2:
      return 'chat-active';
    case 3:
      return 'life-pending';
    case 4:
      return 'life-running';
    case 5:
      return 'suspended';
    default:
      return null;
  }
}

function formatHookStatus(value: unknown): string | null {
  switch (Number(value)) {
    case 1:
      return 'pending';
    case 2:
      return 'running';
    case 3:
      return 'completed';
    case 4:
      return 'failed';
    case 5:
      return 'canceled';
    case 6:
      return 'rescheduled';
    case 7:
      return 'rejected';
    default:
      return null;
  }
}

function formatHookTriggerKind(value: unknown): string | null {
  switch (Number(value)) {
    case 1:
      return 'turn-completed';
    case 2:
      return 'scheduled-time';
    case 3:
      return 'user-idle';
    case 4:
      return 'chat-ended';
    case 5:
      return 'state-condition';
    case 6:
      return 'world-event';
    case 7:
      return 'compound';
    default:
      return null;
  }
}

function formatEventType(value: unknown): string | null {
  switch (Number(value)) {
    case 1:
      return 'lifecycle';
    case 2:
      return 'hook';
    case 3:
      return 'memory';
    case 4:
      return 'budget';
    case 5:
      return 'replication';
    default:
      return null;
  }
}

function formatCanonicalClass(value: unknown): string | null {
  switch (Number(value)) {
    case 2:
      return 'public-shared';
    case 3:
      return 'world-shared';
    case 4:
      return 'dyadic';
    default:
      return null;
  }
}

function formatMemoryRecordKind(value: unknown): string | null {
  switch (Number(value)) {
    case 1:
      return 'episodic';
    case 2:
      return 'semantic';
    case 3:
      return 'observational';
    default:
      return null;
  }
}

function formatMemoryReplicationOutcome(value: unknown): string | null {
  switch (Number(value)) {
    case 1:
      return 'pending';
    case 2:
      return 'synced';
    case 3:
      return 'conflict';
    case 4:
      return 'invalidated';
    default:
      return null;
  }
}

function projectPendingHookInspect(hook: {
  hookId?: unknown;
  status?: unknown;
  trigger?: { triggerKind?: unknown } | null;
  scheduledFor?: { seconds: string; nanos: number } | undefined;
  admittedAt?: { seconds: string; nanos: number } | undefined;
}): RuntimeAgentPendingHookInspect {
  return {
    hookId: normalizeText(hook.hookId),
    status: formatHookStatus(hook.status),
    triggerKind: formatHookTriggerKind(hook.trigger?.triggerKind),
    scheduledFor: timestampToIso(hook.scheduledFor),
    admittedAt: timestampToIso(hook.admittedAt),
  };
}

function projectCanonicalMemoryInspect(view: {
  canonicalClass?: unknown;
  record?: {
    memoryId?: unknown;
    kind?: unknown;
    updatedAt?: { seconds: string; nanos: number } | undefined;
    createdAt?: { seconds: string; nanos: number } | undefined;
    provenance?: { sourceEventId?: unknown } | null;
    payload?: unknown;
  } | null;
  policyReason?: unknown;
  recallScore?: unknown;
}): RuntimeAgentCanonicalMemoryInspect | null {
  const memoryId = normalizeText(view.record?.memoryId);
  const summary = summarizeCanonicalMemoryView(view as never).trim();
  if (!memoryId || !summary) {
    return null;
  }
  return {
    memoryId,
    canonicalClass: formatCanonicalClass(view.canonicalClass),
    kind: formatMemoryRecordKind(view.record?.kind),
    summary,
    updatedAt: timestampToIso(view.record?.updatedAt || view.record?.createdAt),
    sourceEventId: normalizeText(view.record?.provenance?.sourceEventId) || null,
    policyReason: normalizeText(view.policyReason) || null,
    recallScore: normalizeOptionalNumber(view.recallScore),
  };
}

export function createRuntimeAgentInspectAdapter(deps: RuntimeAgentInspectDeps = {}) {
  const getRuntime = deps.getRuntime ?? (() => getPlatformClient().runtime);
  let protectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

  const resolveSubjectUserId = async (): Promise<string> => {
    const subjectUserId = normalizeText(await deps.getSubjectUserId?.());
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
    const normalizedAgentId = normalizeText(agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = {
      appId: runtime.appId,
      subjectUserId,
    };
    const listHooksByStatus = async (statusFilter: number): Promise<RuntimeAgentPendingHookInspect[]> => {
      let pageToken = '';
      const collected: RuntimeAgentPendingHookInspect[] = [];
      do {
        const response = await protectedScopes.withScopes(['runtime.agent.read'], (options) => runtime.agentCore.listPendingHooks({
          context,
          agentId: normalizedAgentId,
          triggerFilter: 0,
          statusFilter,
          pageSize: 200,
          pageToken,
        }, options));
        collected.push(...(response.hooks || []).map(projectPendingHookInspect));
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
        protectedScopes.withScopes(['runtime.agent.read'], (options) => runtime.agentCore.getAgent({
          context,
          agentId: normalizedAgentId,
        }, options)),
        protectedScopes.withScopes(['runtime.agent.read'], (options) => runtime.agentCore.getAgentState({
          context,
          agentId: normalizedAgentId,
        }, options)),
        listHooksByStatus(0),
        listHooksByStatus(3),
        listHooksByStatus(4),
        listHooksByStatus(5),
        listHooksByStatus(6),
        listHooksByStatus(7),
      ]);
      const activeWorldId = normalizeText(stateResponse.state?.activeWorldId);
      const recentCanonicalMemoriesResponse = await protectedScopes.withScopes(['runtime.agent.read'], (options) => runtime.agentCore.queryMemory({
        context,
        agentId: normalizedAgentId,
        query: '',
        limit: MAX_RECENT_CANONICAL_MEMORIES,
        canonicalClasses: [
          MemoryCanonicalClass.PUBLIC_SHARED,
          ...(activeWorldId ? [MemoryCanonicalClass.WORLD_SHARED] : []),
          MemoryCanonicalClass.DYADIC,
        ],
        kinds: [],
        includeInvalidated: false,
      }, options));
      const terminalHooks = [
        ...completedHooks,
        ...failedHooks,
        ...canceledHooks,
        ...rescheduledHooks,
        ...rejectedHooks,
      ]
        .filter((hook) => hook.hookId)
        .sort((left, right) => {
          const leftTime = Date.parse(left.admittedAt || left.scheduledFor || '') || 0;
          const rightTime = Date.parse(right.admittedAt || right.scheduledFor || '') || 0;
          if (leftTime !== rightTime) {
            return rightTime - leftTime;
          }
          return String(right.hookId).localeCompare(String(left.hookId));
        })
        .slice(0, MAX_RECENT_TERMINAL_HOOKS);
      const nextScheduledFor = activeHooks[0]?.scheduledFor || null;
      const recentCanonicalMemories = (recentCanonicalMemoriesResponse.memories || [])
        .map(projectCanonicalMemoryInspect)
        .filter(Boolean) as RuntimeAgentCanonicalMemoryInspect[];
      return {
        lifecycleStatus: formatLifecycleStatus(agentResponse.agent?.lifecycleStatus),
        presentationProfile: readAgentPresentationProfile(agentResponse.agent?.metadata),
        executionState: formatExecutionState(stateResponse.state?.executionState),
        statusText: normalizeText(stateResponse.state?.statusText) || null,
        activeWorldId: activeWorldId || null,
        activeUserId: normalizeText(stateResponse.state?.activeUserId) || null,
        autonomyEnabled: typeof agentResponse.agent?.autonomy?.enabled === 'boolean'
          ? agentResponse.agent.autonomy.enabled
          : null,
        autonomyBudgetExhausted: typeof agentResponse.agent?.autonomy?.budgetExhausted === 'boolean'
          ? agentResponse.agent.autonomy.budgetExhausted
          : null,
        autonomyUsedTokensInWindow: normalizeOptionalNumber(agentResponse.agent?.autonomy?.usedTokensInWindow),
        autonomyDailyTokenBudget: normalizeOptionalNumber(agentResponse.agent?.autonomy?.config?.dailyTokenBudget),
        autonomyMaxTokensPerHook: normalizeOptionalNumber(agentResponse.agent?.autonomy?.config?.maxTokensPerHook),
        autonomyWindowStartedAt: timestampToIso(agentResponse.agent?.autonomy?.windowStartedAt),
        autonomySuspendedUntil: timestampToIso(agentResponse.agent?.autonomy?.suspendedUntil),
        pendingHooksCount: activeHooks.length,
        nextScheduledFor,
        pendingHooks: activeHooks.slice(0, MAX_PENDING_HOOK_PREVIEW),
        recentTerminalHooks: terminalHooks,
        recentCanonicalMemories,
      };
    } catch (error) {
      throw normalizeRuntimeError(error, 'inspect_runtime_agent_core');
    }
  };

  const getPresentationProfile = async (agentId: string): Promise<AvatarPresentationProfile | null> => {
    const normalizedAgentId = normalizeText(agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    try {
      const response = await protectedScopes.withScopes(['runtime.agent.read'], (options) => runtime.agentCore.getAgent({
        context: {
          appId: runtime.appId,
          subjectUserId,
        },
        agentId: normalizedAgentId,
      }, options));
      return readAgentPresentationProfile(response.agent?.metadata);
    } catch (error) {
      throw normalizeRuntimeError(error, 'inspect_runtime_agent_presentation');
    }
  };

  const enableAutonomy = async (agentId: string): Promise<RuntimeAgentAutonomySnapshot> => {
    const normalizedAgentId = normalizeText(agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = {
      appId: runtime.appId,
      subjectUserId,
    };
    try {
      const response = await protectedScopes.withScopes(['runtime.agent.autonomy.write'], (options) => (
        runtime.agentCore.enableAutonomy({
          context,
          agentId: normalizedAgentId,
        }, options)
      ));
      return {
        enabled: typeof response.autonomy?.enabled === 'boolean' ? response.autonomy.enabled : null,
        budgetExhausted: typeof response.autonomy?.budgetExhausted === 'boolean' ? response.autonomy.budgetExhausted : null,
        usedTokensInWindow: normalizeOptionalNumber(response.autonomy?.usedTokensInWindow),
        dailyTokenBudget: normalizeOptionalNumber(response.autonomy?.config?.dailyTokenBudget),
        maxTokensPerHook: normalizeOptionalNumber(response.autonomy?.config?.maxTokensPerHook),
        windowStartedAt: timestampToIso(response.autonomy?.windowStartedAt),
        suspendedUntil: timestampToIso(response.autonomy?.suspendedUntil),
      };
    } catch (error) {
      throw normalizeRuntimeError(error, 'enable_runtime_agent_autonomy');
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
    const normalizedAgentId = normalizeText(input.agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    const mutations: AgentStateMutation[] = [];
    if (input.statusText !== undefined) {
      mutations.push({
        mutation: {
          oneofKind: 'setStatusText',
          setStatusText: {
            statusText: normalizeText(input.statusText),
          },
        },
      });
    }
    if (input.clearWorldContext === true) {
      mutations.push({
        mutation: {
          oneofKind: 'clearWorldContext',
          clearWorldContext: {},
        },
      });
    } else {
      const worldId = normalizeText(input.worldId);
      if (worldId) {
        mutations.push({
          mutation: {
            oneofKind: 'setWorldContext',
            setWorldContext: {
              worldId,
            },
          },
        });
      }
    }
    if (input.clearDyadicContext === true) {
      mutations.push({
        mutation: {
          oneofKind: 'clearDyadicContext',
          clearDyadicContext: {},
        },
      });
    } else {
      const userId = normalizeText(input.userId);
      if (userId) {
        mutations.push({
          mutation: {
            oneofKind: 'setDyadicContext',
            setDyadicContext: {
              userId,
            },
          },
        });
      }
    }
    if (mutations.length === 0) {
      throw new Error('STATE_MUTATION_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = {
      appId: runtime.appId,
      subjectUserId,
    };
    try {
      const response = await protectedScopes.withScopes(['runtime.agent.write'], (options) => (
        runtime.agentCore.updateAgentState({
          context,
          agentId: normalizedAgentId,
          mutations,
        }, options)
      ));
      return {
        executionState: formatExecutionState(response.state?.executionState),
        statusText: normalizeText(response.state?.statusText) || null,
        activeWorldId: normalizeText(response.state?.activeWorldId) || null,
        activeUserId: normalizeText(response.state?.activeUserId) || null,
      };
    } catch (error) {
      throw normalizeRuntimeError(error, 'update_runtime_agent_state');
    }
  };

  const disableAutonomy = async (input: {
    agentId: string;
    reason: string;
  }): Promise<RuntimeAgentAutonomySnapshot> => {
    const normalizedAgentId = normalizeText(input.agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = {
      appId: runtime.appId,
      subjectUserId,
    };
    try {
      const response = await protectedScopes.withScopes(['runtime.agent.autonomy.write'], (options) => (
        runtime.agentCore.disableAutonomy({
          context,
          agentId: normalizedAgentId,
          reason: normalizeText(input.reason),
        }, options)
      ));
      return {
        enabled: typeof response.autonomy?.enabled === 'boolean' ? response.autonomy.enabled : null,
        budgetExhausted: typeof response.autonomy?.budgetExhausted === 'boolean' ? response.autonomy.budgetExhausted : null,
        usedTokensInWindow: normalizeOptionalNumber(response.autonomy?.usedTokensInWindow),
        dailyTokenBudget: normalizeOptionalNumber(response.autonomy?.config?.dailyTokenBudget),
        maxTokensPerHook: normalizeOptionalNumber(response.autonomy?.config?.maxTokensPerHook),
        windowStartedAt: timestampToIso(response.autonomy?.windowStartedAt),
        suspendedUntil: timestampToIso(response.autonomy?.suspendedUntil),
      };
    } catch (error) {
      throw normalizeRuntimeError(error, 'disable_runtime_agent_autonomy');
    }
  };

  const cancelHook = async (input: {
    agentId: string;
    hookId: string;
    reason: string;
  }): Promise<{ hookId: string; status: string | null }> => {
    const normalizedAgentId = normalizeText(input.agentId);
    const normalizedHookId = normalizeText(input.hookId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    if (!normalizedHookId) {
      throw new Error('HOOK_ID_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = {
      appId: runtime.appId,
      subjectUserId,
    };
    try {
      const response = await protectedScopes.withScopes(['runtime.agent.write'], (options) => (
        runtime.agentCore.cancelHook({
          context,
          agentId: normalizedAgentId,
          hookId: normalizedHookId,
          reason: normalizeText(input.reason),
        }, options)
      ));
      return {
        hookId: normalizeText(response.outcome?.hookId) || normalizedHookId,
        status: formatHookStatus(response.outcome?.status),
      };
    } catch (error) {
      throw normalizeRuntimeError(error, 'cancel_runtime_agent_hook');
    }
  };

  const setAutonomyConfig = async (input: {
    agentId: string;
    dailyTokenBudget: string | number;
    maxTokensPerHook: string | number;
  }): Promise<RuntimeAgentAutonomySnapshot> => {
    const normalizedAgentId = normalizeText(input.agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = {
      appId: runtime.appId,
      subjectUserId,
    };
    try {
      const response = await protectedScopes.withScopes(['runtime.agent.autonomy.write'], (options) => (
        runtime.agentCore.setAutonomyConfig({
          context,
          agentId: normalizedAgentId,
          config: {
            dailyTokenBudget: normalizeNonNegativeInteger(input.dailyTokenBudget),
            maxTokensPerHook: normalizeNonNegativeInteger(input.maxTokensPerHook),
          },
        }, options)
      ));
      return {
        enabled: typeof response.autonomy?.enabled === 'boolean' ? response.autonomy.enabled : null,
        budgetExhausted: typeof response.autonomy?.budgetExhausted === 'boolean' ? response.autonomy.budgetExhausted : null,
        usedTokensInWindow: normalizeOptionalNumber(response.autonomy?.usedTokensInWindow),
        dailyTokenBudget: normalizeOptionalNumber(response.autonomy?.config?.dailyTokenBudget),
        maxTokensPerHook: normalizeOptionalNumber(response.autonomy?.config?.maxTokensPerHook),
        windowStartedAt: timestampToIso(response.autonomy?.windowStartedAt),
        suspendedUntil: timestampToIso(response.autonomy?.suspendedUntil),
      };
    } catch (error) {
      throw normalizeRuntimeError(error, 'set_runtime_agent_autonomy_config');
    }
  };

  const subscribePublicEvents = async (input: {
    agentId: string;
    signal?: AbortSignal;
    onEvent: (event: RuntimeAgentInspectEventSummary) => void | Promise<void>;
  }): Promise<void> => {
    const normalizedAgentId = normalizeText(input.agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const protectedScopes = getProtectedAccess();
    const context = {
      appId: runtime.appId,
      subjectUserId,
    };
    try {
      const callOptions = await protectedScopes.getCallOptions(['runtime.agent.read']);
      const stream = await runtime.agentCore.subscribeEvents({
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
        await input.onEvent({
          agentId: normalizeText(event.agentId) || normalizedAgentId,
          eventType: Number(event.eventType) || 0,
          eventTypeLabel: formatEventType(event.eventType),
          sequence: String(event.sequence || ''),
          detailKind: event.detail?.oneofKind || null,
          timestamp: timestampToIso(event.timestamp),
          summaryText: event.detail?.oneofKind === 'hook'
            ? [
              normalizeText(event.detail.hook?.outcome?.hookId) || 'hook',
              formatHookStatus(event.detail.hook?.outcome?.status) || 'unknown',
            ].join(' · ')
            : event.detail?.oneofKind === 'lifecycle'
              ? `current=${formatLifecycleStatus(event.detail.lifecycle?.currentStatus) || 'unknown'}`
              : event.detail?.oneofKind === 'memory'
                ? [
                  `accepted=${event.detail.memory?.accepted?.length || 0}`,
                  `rejected=${event.detail.memory?.rejected?.length || 0}`,
                ].join(' · ')
              : event.detail?.oneofKind === 'budget'
                ? [
                  `budgetExhausted=${event.detail.budget?.budgetExhausted === true}`,
                  `remainingTokens=${normalizeOptionalNumber(event.detail.budget?.remainingTokens) ?? '-'}`,
                ].join(' · ')
                : event.detail?.oneofKind === 'replication'
                  ? [
                    normalizeText(event.detail.replication?.memoryId) || 'memory',
                    event.detail.replication?.replication?.detail?.oneofKind
                      || formatMemoryReplicationOutcome(event.detail.replication?.replication?.outcome)
                      || 'replication',
                  ].join(' · ')
                    : null,
          hookId: event.detail?.oneofKind === 'hook'
            ? normalizeText(event.detail.hook?.outcome?.hookId) || null
            : null,
          hookStatus: event.detail?.oneofKind === 'hook'
            ? formatHookStatus(event.detail.hook?.outcome?.status)
            : null,
          lifecycleStatus: event.detail?.oneofKind === 'lifecycle'
            ? formatLifecycleStatus(event.detail.lifecycle?.currentStatus)
            : null,
          budgetExhausted: event.detail?.oneofKind === 'budget'
            ? event.detail.budget?.budgetExhausted === true
            : null,
          remainingTokens: event.detail?.oneofKind === 'budget'
            ? normalizeOptionalNumber(event.detail.budget?.remainingTokens)
            : null,
        });
      }
    } catch (error) {
      if (input.signal?.aborted) {
        return;
      }
      throw normalizeRuntimeError(error, 'subscribe_runtime_agent_events');
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
