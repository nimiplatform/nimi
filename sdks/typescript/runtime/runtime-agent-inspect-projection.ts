import {
  AgentAutonomyMode,
  AgentEventType,
  AgentExecutionState,
  AgentLifecycleStatus,
  HookAdmissionState,
  HookTriggerFamily,
  type AgentAutonomyState,
  type AgentEvent,
  type AgentStateMutation,
  type AgentStateProjection,
  type PendingHook,
} from '../core-generated/runtime-typed-client';
import type { Struct } from '../core-generated/runtime-protobuf/google/protobuf/struct';
import type { Timestamp } from '../core-generated/runtime-protobuf/google/protobuf/timestamp';
import {
  normalizeNimiRuntimeAgentText,
  toNimiRuntimeIsoFromTimestamp,
} from './runtime-agent-values';
import type {
  NimiRuntimeAgentAutonomyMode,
  NimiRuntimeAgentAutonomySnapshot,
  NimiRuntimeAgentInspectEventSummary,
  NimiRuntimeAgentInspectSnapshot,
  NimiRuntimeAgentPendingHookInspect,
  NimiRuntimeAgentPresentationProfileProjection,
  NimiRuntimeAgentStateMutationInput,
  NimiRuntimeAgentStateSnapshot,
  ProjectNimiRuntimeAgentInspectSnapshotInput,
} from './runtime-agent-inspect-types';
import { projectNimiRuntimeAgentProactiveInterruptibility } from './runtime-agent-proactive-projection';
import { projectNimiRuntimeAgentPresentationRecord } from './runtime-agent-presentation-validation';

export function normalizeNimiRuntimeAgentOptionalNumber(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

export function normalizeNimiRuntimeAgentAutonomyRevision(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^[1-9]\d*$/u.test(normalized) ? normalized : null;
}

function runtimeAgentTimestampToIso(timestamp?: Timestamp): string | null {
  return toNimiRuntimeIsoFromTimestamp(timestamp);
}

export function readNimiRuntimeAgentPresentationProfile(
  agent?: { readonly presentationProfile?: unknown; readonly presentationProfileRevision?: unknown } | null,
): NimiRuntimeAgentPresentationProfileProjection | null {
  return projectNimiRuntimeAgentPresentationRecord(agent).profile;
}

export function formatNimiRuntimeAgentLifecycleStatus(value: unknown): string | null {
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

export function formatNimiRuntimeAgentExecutionState(value: unknown): string | null {
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

export function formatNimiRuntimeAgentAutonomyMode(value: unknown): NimiRuntimeAgentAutonomyMode | null {
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

export function normalizeNimiRuntimeAgentAutonomyModeInput(value: unknown): NimiRuntimeAgentAutonomyMode {
  switch (normalizeNimiRuntimeAgentText(value).toLowerCase()) {
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

export function toNimiRuntimeAgentAutonomyMode(value: NimiRuntimeAgentAutonomyMode): AgentAutonomyMode {
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

export function formatNimiRuntimeAgentHookStatus(value: unknown): string | null {
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

function formatNimiRuntimeAgentHookTriggerKind(input?: {
  readonly triggerFamily?: unknown;
  readonly triggerDetail?: {
    readonly detail?: {
      readonly oneofKind?: string;
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

export function formatNimiRuntimeAgentEventType(value: unknown): string | null {
  switch (Number(value)) {
    case AgentEventType.LIFECYCLE:
      return 'lifecycle';
    case AgentEventType.HOOK:
      return 'hook';
    case AgentEventType.BUDGET:
      return 'budget';
    case AgentEventType.STATE:
      return 'state';
    case AgentEventType.PRESENTATION:
      return 'presentation';
    case AgentEventType.PROACTIVE:
      return 'proactive';
    default:
      return null;
  }
}

export function projectNimiRuntimeAgentPendingHookInspect(
  hook: PendingHook,
): NimiRuntimeAgentPendingHookInspect {
  return {
    hookId: normalizeNimiRuntimeAgentText(hook.intent?.intentId),
    status: formatNimiRuntimeAgentHookStatus(hook.intent?.admissionState),
    triggerKind: formatNimiRuntimeAgentHookTriggerKind(hook.intent),
    scheduledFor: runtimeAgentTimestampToIso(hook.scheduledFor),
    admittedAt: runtimeAgentTimestampToIso(hook.admittedAt),
  };
}

export function projectNimiRuntimeAgentAutonomySnapshot(
  autonomy?: AgentAutonomyState | null,
): NimiRuntimeAgentAutonomySnapshot {
  return {
    revision: normalizeNimiRuntimeAgentAutonomyRevision(autonomy?.revision),
    mode: formatNimiRuntimeAgentAutonomyMode(autonomy?.config?.mode),
    enabled: typeof autonomy?.enabled === 'boolean' ? autonomy.enabled : null,
    budgetExhausted: typeof autonomy?.budgetExhausted === 'boolean' ? autonomy.budgetExhausted : null,
    usedTokensInWindow: normalizeNimiRuntimeAgentOptionalNumber(autonomy?.usedTokensInWindow),
    dailyTokenBudget: normalizeNimiRuntimeAgentOptionalNumber(autonomy?.config?.dailyTokenBudget),
    maxTokensPerHook: normalizeNimiRuntimeAgentOptionalNumber(autonomy?.config?.maxTokensPerHook),
    windowStartedAt: runtimeAgentTimestampToIso(autonomy?.windowStartedAt),
    suspendedUntil: runtimeAgentTimestampToIso(autonomy?.suspendedUntil),
  };
}

export function projectNimiRuntimeAgentStateSnapshot(
  state?: AgentStateProjection | null,
): NimiRuntimeAgentStateSnapshot {
  return {
    executionState: formatNimiRuntimeAgentExecutionState(state?.executionState),
    statusText: normalizeNimiRuntimeAgentText(state?.statusText) || null,
    activeWorldId: normalizeNimiRuntimeAgentText(state?.activeWorldId) || null,
    activeUserId: normalizeNimiRuntimeAgentText(state?.activeUserId) || null,
    updatedAt: runtimeAgentTimestampToIso(state?.updatedAt),
    currentEmotion: normalizeNimiRuntimeAgentText(state?.currentEmotion) || null,
    proactiveInterruptibility: projectNimiRuntimeAgentProactiveInterruptibility(state?.proactiveInterruptibility),
  };
}

export function buildNimiRuntimeAgentStateMutations(
  input: NimiRuntimeAgentStateMutationInput,
): AgentStateMutation[] {
  const mutations: AgentStateMutation[] = [];
  if (input.statusText !== undefined) {
    mutations.push({
      mutation: {
        oneofKind: 'setStatusText',
        setStatusText: {
          statusText: normalizeNimiRuntimeAgentText(input.statusText),
        },
      },
    });
  }
  if (input.clearWorldContext === true) {
    mutations.push({ mutation: { oneofKind: 'clearWorldContext', clearWorldContext: {} } });
  } else {
    const worldId = normalizeNimiRuntimeAgentText(input.worldId);
    if (worldId) {
      mutations.push({ mutation: { oneofKind: 'setWorldContext', setWorldContext: { worldId } } });
    }
  }
  if (input.clearDyadicContext === true) {
    mutations.push({ mutation: { oneofKind: 'clearDyadicContext', clearDyadicContext: {} } });
  } else {
    const userId = normalizeNimiRuntimeAgentText(input.userId);
    if (userId) {
      mutations.push({ mutation: { oneofKind: 'setDyadicContext', setDyadicContext: { userId } } });
    }
  }
  return mutations;
}

export function projectNimiRuntimeAgentInspectSnapshot(
  input: ProjectNimiRuntimeAgentInspectSnapshotInput,
): NimiRuntimeAgentInspectSnapshot {
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
  const state = projectNimiRuntimeAgentStateSnapshot(input.state);
  const autonomy = projectNimiRuntimeAgentAutonomySnapshot(input.agent?.autonomy);
  const presentation = projectNimiRuntimeAgentPresentationRecord(input.agent);

  return {
    lifecycleStatus: formatNimiRuntimeAgentLifecycleStatus(input.agent?.lifecycleStatus),
    presentationProfile: presentation.profile,
    presentationProfileRevision: presentation.committedRevision,
    executionState: state.executionState,
    statusText: state.statusText,
    activeWorldId: state.activeWorldId,
    activeUserId: state.activeUserId,
    updatedAt: state.updatedAt,
    currentEmotion: state.currentEmotion,
    proactiveInterruptibility: state.proactiveInterruptibility,
    autonomyRevision: autonomy.revision,
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
  };
}

export function projectNimiRuntimeAgentInspectEventSummary(input: {
  readonly event: AgentEvent;
  readonly fallbackAgentId?: string;
}): NimiRuntimeAgentInspectEventSummary {
  const event = input.event;
  const normalizedAgentId = normalizeNimiRuntimeAgentText(event.agentId)
    || normalizeNimiRuntimeAgentText(input.fallbackAgentId);
  const detail = event.detail;
  return {
    agentId: normalizedAgentId,
    eventType: Number(event.eventType) || 0,
    eventTypeLabel: formatNimiRuntimeAgentEventType(event.eventType),
    sequence: String(event.sequence || ''),
    detailKind: detail?.oneofKind || null,
    timestamp: runtimeAgentTimestampToIso(event.timestamp),
    summaryText: detail?.oneofKind === 'hook'
      ? [
        normalizeNimiRuntimeAgentText(detail.hook?.intent?.intentId) || 'hook',
        formatNimiRuntimeAgentHookStatus(detail.hook?.family) || 'unknown',
      ].join(' - ')
      : detail?.oneofKind === 'lifecycle'
        ? `current=${formatNimiRuntimeAgentLifecycleStatus(detail.lifecycle?.currentStatus) || 'unknown'}`
        : detail?.oneofKind === 'budget'
            ? [
              `budgetExhausted=${detail.budget?.budgetExhausted === true}`,
              `remainingTokens=${normalizeNimiRuntimeAgentOptionalNumber(detail.budget?.remainingTokens) ?? '-'}`,
            ].join(' - ')
            : null,
    hookId: detail?.oneofKind === 'hook'
      ? normalizeNimiRuntimeAgentText(detail.hook?.intent?.intentId) || null
      : null,
    hookStatus: detail?.oneofKind === 'hook'
      ? formatNimiRuntimeAgentHookStatus(detail.hook?.family)
      : null,
    lifecycleStatus: detail?.oneofKind === 'lifecycle'
      ? formatNimiRuntimeAgentLifecycleStatus(detail.lifecycle?.currentStatus)
      : null,
    budgetExhausted: detail?.oneofKind === 'budget' ? detail.budget?.budgetExhausted === true : null,
    remainingTokens: detail?.oneofKind === 'budget'
      ? normalizeNimiRuntimeAgentOptionalNumber(detail.budget?.remainingTokens)
      : null,
  };
}
