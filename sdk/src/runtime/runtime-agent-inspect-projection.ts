import { asNimiError } from '../core/errors.js';
import { ReasonCode } from '../types/index.js';
import { fromProtoStruct } from './runtime-proto-struct-codec.js';
import { toIsoFromTimestamp } from './runtime-value-utils.js';
import type { Timestamp } from './generated/google/protobuf/timestamp.js';
import type {
  AgentAutonomyState,
  AgentEvent,
  AgentStateMutation,
  AgentStateProjection,
  CanonicalMemoryView,
  PendingHook,
} from './generated/runtime/v1/agent_service.js';
import {
  AgentAutonomyMode,
  AgentEventType,
  AgentExecutionState,
  AgentLifecycleStatus,
  HookAdmissionState,
  HookTriggerFamily,
} from './generated/runtime/v1/agent_service.js';
import {
  MemoryCanonicalClass,
  MemoryRecordKind,
  MemoryReplicationOutcome,
} from './generated/runtime/v1/memory.js';

export type RuntimeAgentPendingHookInspect = {
  hookId: string;
  status: string | null;
  triggerKind: string | null;
  scheduledFor: string | null;
  admittedAt?: string | null;
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

export type RuntimeAgentAutonomyMode = 'off' | 'low' | 'medium' | 'high';

export type RuntimeAgentPresentationProfileProjection = {
  backendKind: 'vrm' | 'live2d';
  avatarAssetRef: string;
  expressionProfileRef: string | null;
  idlePreset: string | null;
  interactionPolicyRef: string | null;
  defaultVoiceReference: string | null;
};

export type RuntimeAgentAutonomySnapshot = {
  mode: RuntimeAgentAutonomyMode | null;
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

export type RuntimeAgentInspectSnapshot = RuntimeAgentStateSnapshot & {
  lifecycleStatus: string | null;
  presentationProfile?: RuntimeAgentPresentationProfileProjection | null;
  autonomyMode: RuntimeAgentAutonomyMode | null;
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

export type ProjectRuntimeAgentInspectSnapshotInput = {
  agent?: {
    lifecycleStatus?: unknown;
    metadata?: unknown;
    autonomy?: AgentAutonomyState | null;
  } | null;
  state?: AgentStateProjection | null;
  activeHooks?: readonly RuntimeAgentPendingHookInspect[];
  terminalHooks?: readonly RuntimeAgentPendingHookInspect[];
  recentCanonicalMemories?: readonly CanonicalMemoryView[];
  maxPendingHookPreview?: number;
  maxRecentTerminalHooks?: number;
};

export type RuntimeAgentStateMutationInput = {
  statusText?: string | null;
  worldId?: string | null;
  clearWorldContext?: boolean;
  userId?: string | null;
  clearDyadicContext?: boolean;
};

export function normalizeRuntimeAgentNonNegativeInteger(value: unknown): string {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return '0';
  }
  return String(Math.trunc(normalized));
}

export function normalizeRuntimeAgentText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRuntimeAgentError(error: unknown, actionHint: string) {
  return asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint,
    source: 'runtime',
  });
}

export function runtimeAgentTimestampToIso(timestamp?: Timestamp): string | null {
  return toIsoFromTimestamp(timestamp) ?? null;
}

export function normalizeRuntimeAgentOptionalNumber(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function parseAvatarBackendKind(value: unknown): RuntimeAgentPresentationProfileProjection['backendKind'] | null {
  const normalized = normalizeRuntimeAgentText(value);
  if (normalized === 'vrm' || normalized === 'live2d') {
    return normalized;
  }
  return null;
}

function parseAvatarPresentationProfile(value: unknown): RuntimeAgentPresentationProfileProjection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const backendKind = parseAvatarBackendKind(record.backendKind);
  const avatarAssetRef = normalizeRuntimeAgentText(record.avatarAssetRef);
  if (!backendKind || !avatarAssetRef) {
    return null;
  }
  return {
    backendKind,
    avatarAssetRef,
    expressionProfileRef: normalizeRuntimeAgentText(record.expressionProfileRef) || null,
    idlePreset: normalizeRuntimeAgentText(record.idlePreset) || null,
    interactionPolicyRef: normalizeRuntimeAgentText(record.interactionPolicyRef) || null,
    defaultVoiceReference: normalizeRuntimeAgentText(record.defaultVoiceReference) || null,
  };
}

export function readRuntimeAgentPresentationProfile(
  metadata?: unknown,
): RuntimeAgentPresentationProfileProjection | null {
  const json = fromProtoStruct(metadata);
  return parseAvatarPresentationProfile(json.presentationProfile);
}

export function formatRuntimeAgentLifecycleStatus(value: unknown): string | null {
  switch (Number(value)) {
    case AgentLifecycleStatus.INITIALIZING:
      return 'initializing';
    case AgentLifecycleStatus.ACTIVE:
      return 'active';
    case AgentLifecycleStatus.SUSPENDED:
      return 'suspended';
    case AgentLifecycleStatus.TERMINATING:
      return 'terminating';
    case AgentLifecycleStatus.TERMINATED:
      return 'terminated';
    default:
      return null;
  }
}

export function formatRuntimeAgentExecutionState(value: unknown): string | null {
  switch (Number(value)) {
    case AgentExecutionState.IDLE:
      return 'idle';
    case AgentExecutionState.CHAT_ACTIVE:
      return 'chat-active';
    case AgentExecutionState.LIFE_PENDING:
      return 'life-pending';
    case AgentExecutionState.LIFE_RUNNING:
      return 'life-running';
    case AgentExecutionState.SUSPENDED:
      return 'suspended';
    default:
      return null;
  }
}

export function formatRuntimeAgentAutonomyMode(value: unknown): RuntimeAgentAutonomyMode | null {
  switch (Number(value)) {
    case AgentAutonomyMode.OFF:
      return 'off';
    case AgentAutonomyMode.LOW:
      return 'low';
    case AgentAutonomyMode.MEDIUM:
      return 'medium';
    case AgentAutonomyMode.HIGH:
      return 'high';
    default:
      return null;
  }
}

export function normalizeRuntimeAgentAutonomyModeInput(value: unknown): RuntimeAgentAutonomyMode {
  switch (normalizeRuntimeAgentText(value).toLowerCase()) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    default:
      return 'off';
  }
}

export function toRuntimeAgentAutonomyMode(value: RuntimeAgentAutonomyMode): AgentAutonomyMode {
  switch (value) {
    case 'low':
      return AgentAutonomyMode.LOW;
    case 'medium':
      return AgentAutonomyMode.MEDIUM;
    case 'high':
      return AgentAutonomyMode.HIGH;
    default:
      return AgentAutonomyMode.OFF;
  }
}

export function formatRuntimeAgentHookStatus(value: unknown): string | null {
  switch (Number(value)) {
    case HookAdmissionState.PROPOSED:
      return 'proposed';
    case HookAdmissionState.PENDING:
      return 'pending';
    case HookAdmissionState.REJECTED:
      return 'rejected';
    case HookAdmissionState.RUNNING:
      return 'running';
    case HookAdmissionState.COMPLETED:
      return 'completed';
    case HookAdmissionState.FAILED:
      return 'failed';
    case HookAdmissionState.CANCELED:
      return 'canceled';
    case HookAdmissionState.RESCHEDULED:
      return 'rescheduled';
    default:
      return null;
  }
}

function formatRuntimeAgentHookTriggerKind(input?: {
  triggerFamily?: unknown;
  triggerDetail?: {
    detail?: {
      oneofKind?: string;
    };
  } | null;
} | null): string | null {
  switch (Number(input?.triggerFamily)) {
    case HookTriggerFamily.TIME:
      return 'scheduled-time';
    case HookTriggerFamily.EVENT:
      switch (input?.triggerDetail?.detail?.oneofKind) {
        case 'eventUserIdle':
          return 'user-idle';
        case 'eventChatEnded':
          return 'chat-ended';
        default:
          return null;
      }
    default:
      return null;
  }
}

export function formatRuntimeAgentEventType(value: unknown): string | null {
  switch (Number(value)) {
    case AgentEventType.LIFECYCLE:
      return 'lifecycle';
    case AgentEventType.HOOK:
      return 'hook';
    case AgentEventType.MEMORY:
      return 'memory';
    case AgentEventType.BUDGET:
      return 'budget';
    case AgentEventType.REPLICATION:
      return 'replication';
    case AgentEventType.STATE:
      return 'state';
    default:
      return null;
  }
}

export function formatRuntimeAgentCanonicalClass(value: unknown): string | null {
  switch (Number(value)) {
    case MemoryCanonicalClass.PUBLIC_SHARED:
      return 'public-shared';
    case MemoryCanonicalClass.WORLD_SHARED:
      return 'world-shared';
    case MemoryCanonicalClass.DYADIC:
      return 'dyadic';
    default:
      return null;
  }
}

export function formatRuntimeAgentMemoryRecordKind(value: unknown): string | null {
  switch (Number(value)) {
    case MemoryRecordKind.EPISODIC:
      return 'episodic';
    case MemoryRecordKind.SEMANTIC:
      return 'semantic';
    case MemoryRecordKind.OBSERVATIONAL:
      return 'observational';
    default:
      return null;
  }
}

export function formatRuntimeAgentMemoryReplicationOutcome(value: unknown): string | null {
  switch (Number(value)) {
    case MemoryReplicationOutcome.PENDING:
      return 'pending';
    case MemoryReplicationOutcome.SYNCED:
      return 'synced';
    case MemoryReplicationOutcome.CONFLICT:
      return 'conflict';
    case MemoryReplicationOutcome.INVALIDATED:
      return 'invalidated';
    default:
      return null;
  }
}

export function summarizeRuntimeAgentCanonicalMemoryView(view: CanonicalMemoryView): string {
  const payload = view.record?.payload;
  switch (payload?.oneofKind) {
    case 'observational':
      return normalizeRuntimeAgentText(payload.observational.observation);
    case 'episodic':
      return normalizeRuntimeAgentText(payload.episodic.summary);
    case 'semantic':
      return [
        normalizeRuntimeAgentText(payload.semantic.subject),
        normalizeRuntimeAgentText(payload.semantic.predicate),
        normalizeRuntimeAgentText(payload.semantic.object),
      ].filter(Boolean).join(' ');
    default:
      return '';
  }
}

export function projectRuntimeAgentPendingHookInspect(hook: PendingHook): RuntimeAgentPendingHookInspect {
  return {
    hookId: normalizeRuntimeAgentText(hook.intent?.intentId),
    status: formatRuntimeAgentHookStatus(hook.intent?.admissionState),
    triggerKind: formatRuntimeAgentHookTriggerKind(hook.intent),
    scheduledFor: runtimeAgentTimestampToIso(hook.scheduledFor),
    admittedAt: runtimeAgentTimestampToIso(hook.admittedAt),
  };
}

export function projectRuntimeAgentCanonicalMemoryInspect(
  view: CanonicalMemoryView,
): RuntimeAgentCanonicalMemoryInspect | null {
  const memoryId = normalizeRuntimeAgentText(view.record?.memoryId);
  const summary = summarizeRuntimeAgentCanonicalMemoryView(view).trim();
  if (!memoryId || !summary) {
    return null;
  }
  return {
    memoryId,
    canonicalClass: formatRuntimeAgentCanonicalClass(view.canonicalClass),
    kind: formatRuntimeAgentMemoryRecordKind(view.record?.kind),
    summary,
    updatedAt: runtimeAgentTimestampToIso(view.record?.updatedAt || view.record?.createdAt),
    sourceEventId: normalizeRuntimeAgentText(view.record?.provenance?.sourceEventId) || null,
    policyReason: normalizeRuntimeAgentText(view.policyReason) || null,
    recallScore: normalizeRuntimeAgentOptionalNumber(view.recallScore),
  };
}

export function projectRuntimeAgentAutonomySnapshot(
  autonomy?: AgentAutonomyState | null,
): RuntimeAgentAutonomySnapshot {
  return {
    mode: formatRuntimeAgentAutonomyMode(autonomy?.config?.mode),
    enabled: typeof autonomy?.enabled === 'boolean' ? autonomy.enabled : null,
    budgetExhausted: typeof autonomy?.budgetExhausted === 'boolean' ? autonomy.budgetExhausted : null,
    usedTokensInWindow: normalizeRuntimeAgentOptionalNumber(autonomy?.usedTokensInWindow),
    dailyTokenBudget: normalizeRuntimeAgentOptionalNumber(autonomy?.config?.dailyTokenBudget),
    maxTokensPerHook: normalizeRuntimeAgentOptionalNumber(autonomy?.config?.maxTokensPerHook),
    windowStartedAt: runtimeAgentTimestampToIso(autonomy?.windowStartedAt),
    suspendedUntil: runtimeAgentTimestampToIso(autonomy?.suspendedUntil),
  };
}

export function projectRuntimeAgentStateSnapshot(
  state?: AgentStateProjection | null,
): RuntimeAgentStateSnapshot {
  return {
    executionState: formatRuntimeAgentExecutionState(state?.executionState),
    statusText: normalizeRuntimeAgentText(state?.statusText) || null,
    activeWorldId: normalizeRuntimeAgentText(state?.activeWorldId) || null,
    activeUserId: normalizeRuntimeAgentText(state?.activeUserId) || null,
  };
}

export function buildRuntimeAgentStateMutations(input: RuntimeAgentStateMutationInput): AgentStateMutation[] {
  const mutations: AgentStateMutation[] = [];
  if (input.statusText !== undefined) {
    mutations.push({
      mutation: {
        oneofKind: 'setStatusText',
        setStatusText: {
          statusText: normalizeRuntimeAgentText(input.statusText),
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
    const worldId = normalizeRuntimeAgentText(input.worldId);
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
    const userId = normalizeRuntimeAgentText(input.userId);
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
  return mutations;
}

export function projectRuntimeAgentInspectSnapshot(
  input: ProjectRuntimeAgentInspectSnapshotInput,
): RuntimeAgentInspectSnapshot {
  const activeHooks = [...(input.activeHooks || [])];
  const terminalHooks = [...(input.terminalHooks || [])]
    .filter((hook) => hook.hookId)
    .sort((left, right) => {
      const leftTime = Date.parse(left.admittedAt || left.scheduledFor || '') || 0;
      const rightTime = Date.parse(right.admittedAt || right.scheduledFor || '') || 0;
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return String(right.hookId).localeCompare(String(left.hookId));
    })
    .slice(0, input.maxRecentTerminalHooks ?? 6);
  const state = projectRuntimeAgentStateSnapshot(input.state);
  const autonomy = projectRuntimeAgentAutonomySnapshot(input.agent?.autonomy);
  const recentCanonicalMemories = (input.recentCanonicalMemories || [])
    .map(projectRuntimeAgentCanonicalMemoryInspect)
    .filter((view): view is RuntimeAgentCanonicalMemoryInspect => Boolean(view));

  return {
    lifecycleStatus: formatRuntimeAgentLifecycleStatus(input.agent?.lifecycleStatus),
    presentationProfile: readRuntimeAgentPresentationProfile(input.agent?.metadata),
    executionState: state.executionState,
    statusText: state.statusText,
    activeWorldId: state.activeWorldId,
    activeUserId: state.activeUserId,
    autonomyMode: autonomy.mode,
    autonomyEnabled: autonomy.enabled,
    autonomyBudgetExhausted: autonomy.budgetExhausted,
    autonomyUsedTokensInWindow: autonomy.usedTokensInWindow,
    autonomyDailyTokenBudget: autonomy.dailyTokenBudget,
    autonomyMaxTokensPerHook: autonomy.maxTokensPerHook,
    autonomyWindowStartedAt: autonomy.windowStartedAt,
    autonomySuspendedUntil: autonomy.suspendedUntil,
    pendingHooksCount: activeHooks.length,
    nextScheduledFor: activeHooks[0]?.scheduledFor || null,
    pendingHooks: activeHooks.slice(0, input.maxPendingHookPreview ?? 3),
    recentTerminalHooks: terminalHooks,
    recentCanonicalMemories,
  };
}

export function projectRuntimeAgentInspectEventSummary(input: {
  event: AgentEvent;
  fallbackAgentId?: string;
}): RuntimeAgentInspectEventSummary {
  const event = input.event;
  const normalizedAgentId = normalizeRuntimeAgentText(event.agentId)
    || normalizeRuntimeAgentText(input.fallbackAgentId);
  const detail = event.detail;
  return {
    agentId: normalizedAgentId,
    eventType: Number(event.eventType) || 0,
    eventTypeLabel: formatRuntimeAgentEventType(event.eventType),
    sequence: String(event.sequence || ''),
    detailKind: detail?.oneofKind || null,
    timestamp: runtimeAgentTimestampToIso(event.timestamp),
    summaryText: detail?.oneofKind === 'hook'
      ? [
        normalizeRuntimeAgentText(detail.hook?.intent?.intentId) || 'hook',
        formatRuntimeAgentHookStatus(detail.hook?.family) || 'unknown',
      ].join(' · ')
      : detail?.oneofKind === 'lifecycle'
        ? `current=${formatRuntimeAgentLifecycleStatus(detail.lifecycle?.currentStatus) || 'unknown'}`
        : detail?.oneofKind === 'memory'
          ? [
            `accepted=${detail.memory?.accepted?.length || 0}`,
            `rejected=${detail.memory?.rejected?.length || 0}`,
          ].join(' · ')
          : detail?.oneofKind === 'budget'
            ? [
              `budgetExhausted=${detail.budget?.budgetExhausted === true}`,
              `remainingTokens=${normalizeRuntimeAgentOptionalNumber(detail.budget?.remainingTokens) ?? '-'}`,
            ].join(' · ')
            : detail?.oneofKind === 'replication'
              ? [
                normalizeRuntimeAgentText(detail.replication?.memoryId) || 'memory',
                detail.replication?.replication?.detail?.oneofKind
                  || formatRuntimeAgentMemoryReplicationOutcome(detail.replication?.replication?.outcome)
                  || 'replication',
              ].join(' · ')
              : null,
    hookId: detail?.oneofKind === 'hook'
      ? normalizeRuntimeAgentText(detail.hook?.intent?.intentId) || null
      : null,
    hookStatus: detail?.oneofKind === 'hook'
      ? formatRuntimeAgentHookStatus(detail.hook?.family)
      : null,
    lifecycleStatus: detail?.oneofKind === 'lifecycle'
      ? formatRuntimeAgentLifecycleStatus(detail.lifecycle?.currentStatus)
      : null,
    budgetExhausted: detail?.oneofKind === 'budget'
      ? detail.budget?.budgetExhausted === true
      : null,
    remainingTokens: detail?.oneofKind === 'budget'
      ? normalizeRuntimeAgentOptionalNumber(detail.budget?.remainingTokens)
      : null,
  };
}
