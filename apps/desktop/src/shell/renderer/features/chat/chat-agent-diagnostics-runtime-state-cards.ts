import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type {
  RuntimeAgentInspectEventSummary,
  RuntimeAgentInspectSnapshot,
} from '@renderer/infra/runtime-agent-inspect';
import type { AgentDiagnosticsCardData } from './chat-agent-diagnostics-view-model';

type RuntimeStateCardsInput = {
  activeTarget: AgentLocalTargetSnapshot | null;
  recentRuntimeEvents: readonly RuntimeAgentInspectEventSummary[];
  runtimeInspect: RuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
};

function joinDetails(parts: Array<string | null | undefined>): string | null {
  const normalized = parts
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized.join('\n') : null;
}

function buildAgentStateCard(input: RuntimeStateCardsInput): AgentDiagnosticsCardData | null {
  if (!input.activeTarget) {
    return null;
  }
  if (input.runtimeInspectLoading) {
    return {
      key: 'agent-state',
      label: 'Agent State',
      value: 'Loading…',
      detail: null,
    };
  }
  if (!input.runtimeInspect) {
    return null;
  }
  return {
    key: 'agent-state',
    label: 'Agent State',
    value: input.runtimeInspect.statusText || input.runtimeInspect.executionState || 'Captured',
    detail: joinDetails([
      input.runtimeInspect.lifecycleStatus ? `lifecycle=${input.runtimeInspect.lifecycleStatus}` : null,
      input.runtimeInspect.executionState ? `executionState=${input.runtimeInspect.executionState}` : null,
      input.runtimeInspect.activeWorldId ? `activeWorldId=${input.runtimeInspect.activeWorldId}` : null,
      input.runtimeInspect.activeUserId ? `activeUserId=${input.runtimeInspect.activeUserId}` : null,
    ]),
  };
}

function buildAutonomyCard(input: RuntimeStateCardsInput): AgentDiagnosticsCardData | null {
  if (!input.activeTarget) {
    return null;
  }
  if (input.runtimeInspectLoading) {
    return {
      key: 'agent-autonomy',
      label: 'Autonomy',
      value: 'Loading…',
      detail: null,
    };
  }
  if (!input.runtimeInspect) {
    return null;
  }
  return {
    key: 'agent-autonomy',
    label: 'Autonomy',
    value: input.runtimeInspect.autonomyEnabled === true
      ? 'Enabled'
      : input.runtimeInspect.autonomyEnabled === false
        ? 'Disabled'
        : 'Unavailable',
    detail: joinDetails([
      input.runtimeInspect.autonomyMode
        ? `mode=${input.runtimeInspect.autonomyMode}`
        : null,
      input.runtimeInspect.autonomyBudgetExhausted !== null
        ? `budgetExhausted=${input.runtimeInspect.autonomyBudgetExhausted}`
        : null,
      input.runtimeInspect.autonomyUsedTokensInWindow !== null
        ? `usedTokensInWindow=${input.runtimeInspect.autonomyUsedTokensInWindow}`
        : null,
      input.runtimeInspect.autonomyDailyTokenBudget !== null
        ? `dailyTokenBudget=${input.runtimeInspect.autonomyDailyTokenBudget}`
        : null,
      input.runtimeInspect.autonomyMaxTokensPerHook !== null
        ? `maxTokensPerHook=${input.runtimeInspect.autonomyMaxTokensPerHook}`
        : null,
      input.runtimeInspect.autonomyWindowStartedAt
        ? `windowStartedAt=${input.runtimeInspect.autonomyWindowStartedAt}`
        : null,
      input.runtimeInspect.autonomySuspendedUntil
        ? `suspendedUntil=${input.runtimeInspect.autonomySuspendedUntil}`
        : null,
    ]),
  };
}

function buildPendingHooksCard(input: RuntimeStateCardsInput): AgentDiagnosticsCardData | null {
  if (!input.activeTarget) {
    return null;
  }
  if (input.runtimeInspectLoading) {
    return {
      key: 'agent-hooks',
      label: 'Pending Hooks',
      value: 'Loading…',
      detail: null,
    };
  }
  if (!input.runtimeInspect) {
    return null;
  }
  return {
    key: 'agent-hooks',
    label: 'Pending Hooks',
    value: String(input.runtimeInspect.pendingHooksCount),
    detail: joinDetails([
      input.runtimeInspect.pendingHooksCount > input.runtimeInspect.pendingHooks.length
        ? `showing=${input.runtimeInspect.pendingHooks.length}/${input.runtimeInspect.pendingHooksCount}`
        : null,
      input.runtimeInspect.nextScheduledFor
        ? `nextScheduledFor=${input.runtimeInspect.nextScheduledFor}`
        : null,
      ...input.runtimeInspect.pendingHooks.map((hook) => (
        [
          hook.hookId || '(hook)',
          hook.status || 'unknown',
          hook.triggerKind || 'unknown-trigger',
          hook.scheduledFor || 'unscheduled',
        ].join(' · ')
      )),
    ]),
  };
}

function buildTerminalHookHistoryCard(input: RuntimeStateCardsInput): AgentDiagnosticsCardData | null {
  if (!input.activeTarget) {
    return null;
  }
  if (input.runtimeInspectLoading) {
    return {
      key: 'agent-terminal-hook-history',
      label: 'Terminal Hook History',
      value: 'Loading…',
      detail: null,
    };
  }
  if (!input.runtimeInspect || input.runtimeInspect.recentTerminalHooks.length === 0) {
    return null;
  }
  const latest = input.runtimeInspect.recentTerminalHooks[0] || null;
  return {
    key: 'agent-terminal-hook-history',
    label: 'Terminal Hook History',
    value: latest?.status || 'Captured',
    detail: joinDetails(input.runtimeInspect.recentTerminalHooks.map((hook) => (
      [
        hook.hookId || '(hook)',
        hook.status || 'unknown',
        hook.triggerKind || 'unknown-trigger',
        hook.admittedAt || hook.scheduledFor || null,
      ].filter(Boolean).join(' · ')
    ))),
  };
}

function buildRecentCanonicalMemoryCard(input: RuntimeStateCardsInput): AgentDiagnosticsCardData | null {
  if (!input.activeTarget) {
    return null;
  }
  if (input.runtimeInspectLoading) {
    return {
      key: 'agent-canonical-memory-history',
      label: 'Recent Memory',
      value: 'Loading…',
      detail: null,
    };
  }
  if (!input.runtimeInspect || input.runtimeInspect.recentCanonicalMemories.length === 0) {
    return null;
  }
  const latest = input.runtimeInspect.recentCanonicalMemories[0] || null;
  return {
    key: 'agent-canonical-memory-history',
    label: 'Recent Memory',
    value: latest?.canonicalClass || 'Captured',
    detail: joinDetails(input.runtimeInspect.recentCanonicalMemories.map((memory) => (
      [
        memory.memoryId,
        memory.canonicalClass || 'memory',
        memory.kind || 'unknown-kind',
        memory.summary,
        memory.updatedAt || null,
      ].filter(Boolean).join(' · ')
    ))),
  };
}

function buildRecentEventsCard(input: RuntimeStateCardsInput): AgentDiagnosticsCardData | null {
  if (!input.activeTarget || input.recentRuntimeEvents.length === 0) {
    return null;
  }
  const latest = input.recentRuntimeEvents[0] || null;
  return {
    key: 'agent-recent-events',
    label: 'Recent Events',
    value: latest?.eventTypeLabel || latest?.detailKind || 'Captured',
    detail: joinDetails(input.recentRuntimeEvents.slice(0, 4).map((event) => (
      [
        event.sequence ? `#${event.sequence}` : null,
        event.eventTypeLabel || event.detailKind || 'event',
        event.summaryText || null,
        event.timestamp || null,
      ].filter(Boolean).join(' · ')
    ))),
  };
}

function buildRecentHookOutcomesCard(input: RuntimeStateCardsInput): AgentDiagnosticsCardData | null {
  if (!input.activeTarget) {
    return null;
  }
  const hookEvents = input.recentRuntimeEvents.filter((event) => event.detailKind === 'hook');
  if (hookEvents.length === 0) {
    return null;
  }
  const latest = hookEvents[0] || null;
  return {
    key: 'agent-hook-history',
    label: 'Recent Hook Outcomes',
    value: latest?.hookStatus || 'Captured',
    detail: joinDetails(hookEvents.slice(0, 4).map((event) => (
      [
        event.hookId || '(hook)',
        event.hookStatus || 'unknown',
        event.timestamp || null,
      ].filter(Boolean).join(' · ')
    ))),
  };
}

export function buildAgentRuntimeStateCards(input: RuntimeStateCardsInput): AgentDiagnosticsCardData[] {
  return [
    buildAgentStateCard(input),
    buildAutonomyCard(input),
    buildPendingHooksCard(input),
    buildTerminalHookHistoryCard(input),
    buildRecentCanonicalMemoryCard(input),
    buildRecentEventsCard(input),
    buildRecentHookOutcomesCard(input),
  ].filter(Boolean) as AgentDiagnosticsCardData[];
}
