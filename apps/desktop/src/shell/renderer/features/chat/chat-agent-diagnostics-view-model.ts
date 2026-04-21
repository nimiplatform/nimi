import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type {
  RuntimeAgentInspectEventSummary,
  RuntimeAgentInspectSnapshot,
} from '@renderer/infra/runtime-agent-inspect';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';

export type DiagnosticsTranslate = (key: string, options?: { defaultValue?: string }) => string;

export type AgentDiagnosticsCardData = {
  key: string;
  label: string;
  value: string;
  detail?: string | null;
};

export type AgentDiagnosticsViewModel = {
  runtimeCard: AgentDiagnosticsCardData;
  stateCards: AgentDiagnosticsCardData[];
  turnCards: AgentDiagnosticsCardData[];
  emptyLabel: string | null;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function joinDetails(parts: Array<string | null | undefined>): string | null {
  const normalized = parts
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized.join('\n') : null;
}

function formatTokenCount(value: unknown): string | null {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : null;
}

function formatUsage(input: AgentTurnLifecycleState['usage']): string | null {
  if (!input) {
    return null;
  }
  const details: string[] = [];
  const inputStr = formatTokenCount(input.inputTokens);
  if (inputStr) {
    details.push(`Input: ${inputStr} tokens`);
  }
  const outputStr = formatTokenCount(input.outputTokens);
  if (outputStr) {
    details.push(`Output: ${outputStr} tokens`);
  }
  return details.length > 0 ? details.join(' · ') : null;
}

function formatContextWindowSource(source: string | undefined | null): string {
  switch (source) {
  case 'route-profile':
    return 'Model profile';
  case 'default-estimate':
    return 'Default estimate';
  default:
    return '-';
  }
}

function hasRecentTurn(lifecycle: AgentTurnLifecycleState | null): boolean {
  if (!lifecycle) {
    return false;
  }
  return lifecycle.terminal !== 'running'
    || Boolean(lifecycle.traceId)
    || Boolean(lifecycle.promptTraceId)
    || Boolean(lifecycle.runtimeAgentChat)
    || Boolean(lifecycle.outputText)
    || Boolean(lifecycle.reasoningText)
    || Boolean(lifecycle.error)
    || Boolean(lifecycle.usage)
    || Boolean(lifecycle.diagnostics);
}

function buildTurnStatusCard(
  lifecycle: AgentTurnLifecycleState,
): AgentDiagnosticsCardData {
  if (lifecycle.terminal === 'completed' && lifecycle.diagnostics?.recoveryPath !== 'none') {
    return {
      key: 'turn-status',
      label: 'Last Turn',
      value: 'Recovered',
      detail: joinDetails([
        lifecycle.error?.message || null,
        `classification=${lifecycle.diagnostics?.classification || '-'}`,
        `recoveryPath=${lifecycle.diagnostics?.recoveryPath || '-'}`,
      ]),
    };
  }
  if (lifecycle.terminal === 'completed') {
    return {
      key: 'turn-status',
      label: 'Last Turn',
      value: 'Completed',
      detail: `classification=${lifecycle.diagnostics?.classification || '-'}`,
    };
  }
  if (lifecycle.terminal === 'failed' && lifecycle.diagnostics?.suspectedTruncation) {
    return {
      key: 'turn-status',
      label: 'Last Turn',
      value: 'Suspected truncation',
      detail: lifecycle.error?.message || 'Structured output did not complete.',
    };
  }
  if (lifecycle.terminal === 'failed') {
    return {
      key: 'turn-status',
      label: 'Last Turn',
      value: 'Failed',
      detail: lifecycle.error?.message || 'Structured output was invalid.',
    };
  }
  if (lifecycle.terminal === 'canceled') {
    return {
      key: 'turn-status',
      label: 'Last Turn',
      value: 'Canceled',
      detail: lifecycle.error?.message || null,
    };
  }
  return {
    key: 'turn-status',
    label: 'Last Turn',
    value: 'Running',
    detail: null,
  };
}

function buildTraceCard(lifecycle: AgentTurnLifecycleState): AgentDiagnosticsCardData {
  return {
    key: 'turn-trace',
    label: 'Trace',
    value: lifecycle.traceId || '-',
    detail: lifecycle.promptTraceId ? `promptTraceId=${lifecycle.promptTraceId}` : null,
  };
}

function buildRuntimeAgentChatCard(lifecycle: AgentTurnLifecycleState): AgentDiagnosticsCardData | null {
  if (!lifecycle.runtimeAgentChat) {
    return null;
  }
  return {
    key: 'turn-runtime-agent-chat',
    label: 'Runtime Chat',
    value: lifecycle.runtimeAgentChat.sessionId || 'Captured',
    detail: joinDetails([
      lifecycle.runtimeAgentChat.runtimeTurnId
        ? `runtimeTurnId=${lifecycle.runtimeAgentChat.runtimeTurnId}`
        : null,
      lifecycle.runtimeAgentChat.route
        ? `route=${lifecycle.runtimeAgentChat.route}`
        : null,
      lifecycle.runtimeAgentChat.modelId
        ? `modelId=${lifecycle.runtimeAgentChat.modelId}`
        : null,
      lifecycle.runtimeAgentChat.connectorId
        ? `connectorId=${lifecycle.runtimeAgentChat.connectorId}`
        : null,
    ]),
  };
}

function formatFinishReason(reason: string | null | undefined): string {
  switch (reason) {
  case 'stop':
    return 'Completed';
  case 'length':
    return 'Reached token limit';
  case 'content_filter':
    return 'Filtered by provider';
  default:
    return reason || '-';
  }
}

function buildFinishCard(lifecycle: AgentTurnLifecycleState): AgentDiagnosticsCardData {
  return {
    key: 'turn-finish',
    label: 'Result',
    value: formatFinishReason(lifecycle.diagnostics?.finishReason),
    detail: formatUsage(lifecycle.usage),
  };
}

function buildOutputCard(lifecycle: AgentTurnLifecycleState): AgentDiagnosticsCardData {
  const diagnostics = lifecycle.diagnostics;
  return {
    key: 'turn-output',
    label: 'Output',
    value: diagnostics?.classification || 'No diagnostics',
    detail: joinDetails([
      diagnostics ? `recoveryPath=${diagnostics.recoveryPath}` : null,
      diagnostics ? `suspectedTruncation=${diagnostics.suspectedTruncation}` : null,
      diagnostics?.parseErrorDetail ? `parseError=${diagnostics.parseErrorDetail}` : null,
      diagnostics ? `rawOutputChars=${diagnostics.rawOutputChars}` : null,
      diagnostics ? `normalizedOutputChars=${diagnostics.normalizedOutputChars}` : null,
    ]),
  };
}

function buildBudgetCard(lifecycle: AgentTurnLifecycleState): AgentDiagnosticsCardData {
  const diagnostics = lifecycle.diagnostics;
  const preflight = diagnostics?.preflight;
  const overflow = diagnostics?.promptOverflow === true;

  const value = overflow
    ? 'Context limit exceeded'
    : formatContextWindowSource(diagnostics?.contextWindowSource);

  const details: Array<string | null> = [];
  const maxOutput = formatTokenCount(diagnostics?.maxOutputTokensRequested);
  if (maxOutput) {
    details.push(`Max output: ${maxOutput} tokens`);
  }
  const usageStr = formatUsage(lifecycle.usage);
  if (usageStr) {
    details.push(usageStr);
  }
  if (preflight) {
    const totalInput = formatTokenCount(preflight.totalInputTokens);
    const budget = formatTokenCount(preflight.promptBudgetTokens);
    if (totalInput && budget) {
      details.push(`Prompt: ${totalInput} / ${budget} tokens`);
    }
    const system = formatTokenCount(preflight.systemTokens);
    if (system) {
      details.push(`System: ${system} tokens`);
    }
    const history = formatTokenCount(preflight.historyTokens);
    if (history) {
      details.push(`History: ${history} tokens`);
    }
    const user = formatTokenCount(preflight.userTokens);
    if (user) {
      details.push(`User: ${user} tokens`);
    }
  }
  if (overflow) {
    details.push('The prompt exceeded the available context window.');
  }

  return {
    key: 'turn-budget',
    label: 'Context',
    value,
    detail: joinDetails(details),
  };
}

function buildAgentStateCard(input: {
  activeTarget: AgentLocalTargetSnapshot | null;
  runtimeInspect: RuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
}): AgentDiagnosticsCardData | null {
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

function buildAutonomyCard(input: {
  activeTarget: AgentLocalTargetSnapshot | null;
  runtimeInspect: RuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
}): AgentDiagnosticsCardData | null {
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

function buildPendingHooksCard(input: {
  activeTarget: AgentLocalTargetSnapshot | null;
  runtimeInspect: RuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
}): AgentDiagnosticsCardData | null {
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

function buildTerminalHookHistoryCard(input: {
  activeTarget: AgentLocalTargetSnapshot | null;
  runtimeInspect: RuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
}): AgentDiagnosticsCardData | null {
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

function buildRecentCanonicalMemoryCard(input: {
  activeTarget: AgentLocalTargetSnapshot | null;
  runtimeInspect: RuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
}): AgentDiagnosticsCardData | null {
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

function buildRecentEventsCard(input: {
  activeTarget: AgentLocalTargetSnapshot | null;
  recentRuntimeEvents: readonly RuntimeAgentInspectEventSummary[];
}): AgentDiagnosticsCardData | null {
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

function buildRecentHookOutcomesCard(input: {
  activeTarget: AgentLocalTargetSnapshot | null;
  recentRuntimeEvents: readonly RuntimeAgentInspectEventSummary[];
}): AgentDiagnosticsCardData | null {
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

function buildImageCard(lifecycle: AgentTurnLifecycleState): AgentDiagnosticsCardData | null {
  const image = lifecycle.diagnostics?.image;
  if (!image) {
    return null;
  }
  const hasContent = Object.values(image).some((value) => value !== null && value !== '');
  if (!hasContent) {
    return null;
  }
  return {
    key: 'turn-image',
    label: 'Image Path',
    value: image.queueSerialized ? 'Serialized queue' : 'Captured',
    detail: joinDetails([
      image.textPlanningMs !== null ? `textPlanningMs=${image.textPlanningMs}` : null,
      image.imageJobSubmitMs !== null ? `imageJobSubmitMs=${image.imageJobSubmitMs}` : null,
      image.imageLoadMs !== null ? `imageLoadMs=${image.imageLoadMs}` : null,
      image.imageGenerateMs !== null ? `imageGenerateMs=${image.imageGenerateMs}` : null,
      image.artifactHydrateMs !== null ? `artifactHydrateMs=${image.artifactHydrateMs}` : null,
      image.queueWaitMs !== null ? `queueWaitMs=${image.queueWaitMs}` : null,
      image.loadCacheHit !== null ? `loadCacheHit=${image.loadCacheHit}` : null,
      image.residentReused !== null ? `residentReused=${image.residentReused}` : null,
      image.residentRestarted !== null ? `residentRestarted=${image.residentRestarted}` : null,
      image.queueSerialized !== null ? `queueSerialized=${image.queueSerialized}` : null,
      image.profileOverrideStep !== null ? `profileOverrideStep=${image.profileOverrideStep}` : null,
      image.profileOverrideCfgScale !== null ? `profileOverrideCfgScale=${image.profileOverrideCfgScale}` : null,
      image.profileOverrideSampler ? `profileOverrideSampler=${image.profileOverrideSampler}` : null,
      image.profileOverrideScheduler ? `profileOverrideScheduler=${image.profileOverrideScheduler}` : null,
    ]),
  };
}

function buildPromptCard(lifecycle: AgentTurnLifecycleState): AgentDiagnosticsCardData | null {
  const prompt = normalizeText(lifecycle.diagnostics?.requestPrompt);
  if (!prompt) {
    return null;
  }
  return {
    key: 'turn-prompt',
    label: 'Prompt',
    value: 'Captured',
    detail: joinDetails([
      lifecycle.diagnostics?.requestSystemPrompt
        ? `systemPrompt:\n${lifecycle.diagnostics.requestSystemPrompt}`
        : null,
      `prompt:\n${prompt}`,
    ]),
  };
}

function buildReturnDataCard(lifecycle: AgentTurnLifecycleState): AgentDiagnosticsCardData | null {
  const rawModelOutputText = lifecycle.diagnostics?.rawModelOutputText || null;
  const normalizedModelOutputText = lifecycle.diagnostics?.normalizedModelOutputText || null;
  if (!rawModelOutputText && !normalizedModelOutputText) {
    return null;
  }
  return {
    key: 'turn-return-data',
    label: 'Returned Data',
    value: 'Captured',
    detail: joinDetails([
      rawModelOutputText ? `raw:\n${rawModelOutputText}` : null,
      normalizedModelOutputText && normalizedModelOutputText !== rawModelOutputText
        ? `normalized:\n${normalizedModelOutputText}`
        : null,
    ]),
  };
}

function buildFollowUpChainCard(lifecycle: AgentTurnLifecycleState): AgentDiagnosticsCardData | null {
  const diagnostics = lifecycle.diagnostics;
  if (!diagnostics?.chainId && !diagnostics?.followUpDepth) {
    return null;
  }
  return {
    key: 'turn-follow-up-chain',
    label: 'Follow-up Chain',
    value: diagnostics.followUpDepth && diagnostics.maxFollowUpTurns
      ? `${diagnostics.followUpDepth}/${diagnostics.maxFollowUpTurns}`
      : 'Captured',
    detail: joinDetails([
      diagnostics.chainId ? `chainId=${diagnostics.chainId}` : null,
      diagnostics.followUpSourceActionId ? `sourceActionId=${diagnostics.followUpSourceActionId}` : null,
      `followUpCanceledByUser=${diagnostics.followUpCanceledByUser}`,
    ]),
  };
}

export function buildAgentDiagnosticsViewModel(input: {
  activeTarget: AgentLocalTargetSnapshot | null;
  lifecycle: AgentTurnLifecycleState | null;
  recentRuntimeEvents: readonly RuntimeAgentInspectEventSummary[];
  routeReady: boolean;
  runtimeInspect: RuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
  t: DiagnosticsTranslate;
  targetsPending: boolean;
}): AgentDiagnosticsViewModel {
  const runtimeCard: AgentDiagnosticsCardData = {
    key: 'runtime',
    label: input.t('Chat.diagnosticsRuntimeLabel', { defaultValue: 'Runtime' }),
    value: input.targetsPending
      ? input.t('Chat.settingsLoading', { defaultValue: 'Loading models...' })
      : input.routeReady
        ? input.t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' })
        : input.t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' }),
    detail: String(
      input.activeTarget?.ownershipType
      || input.activeTarget?.worldName
      || input.t('Chat.agentRouteRequired', {
        defaultValue: 'Agent mode requires a local or cloud runtime route. Configure one in runtime settings.',
      }),
    ).trim(),
  };
  const stateCards = [
    buildAgentStateCard(input),
    buildAutonomyCard(input),
    buildPendingHooksCard(input),
    buildTerminalHookHistoryCard(input),
    buildRecentCanonicalMemoryCard(input),
    buildRecentEventsCard(input),
    buildRecentHookOutcomesCard(input),
  ].filter(Boolean) as AgentDiagnosticsCardData[];
  if (!hasRecentTurn(input.lifecycle)) {
    return {
      runtimeCard,
      stateCards,
      turnCards: [],
      emptyLabel: 'No recent agent turn diagnostics yet.',
    };
  }
  const lifecycle = input.lifecycle!;
  return {
    runtimeCard,
    stateCards,
    turnCards: [
      buildTurnStatusCard(lifecycle),
      buildTraceCard(lifecycle),
      buildRuntimeAgentChatCard(lifecycle),
      buildFinishCard(lifecycle),
      buildOutputCard(lifecycle),
      buildBudgetCard(lifecycle),
      buildFollowUpChainCard(lifecycle),
      buildImageCard(lifecycle),
      buildPromptCard(lifecycle),
      buildReturnDataCard(lifecycle),
    ].filter(Boolean) as AgentDiagnosticsCardData[],
    emptyLabel: null,
  };
}
