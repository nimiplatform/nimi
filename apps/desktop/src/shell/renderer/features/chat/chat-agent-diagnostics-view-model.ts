import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type {
  NimiRuntimeAgentInspectEventSummary,
  NimiRuntimeAgentInspectSnapshot,
} from '@renderer/infra/runtime-agent-inspect';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import { buildAgentRuntimeStateCards } from './chat-agent-diagnostics-runtime-state-cards';

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
    || Boolean(lifecycle.runtimeAgentTurns)
    || Boolean(lifecycle.outputText)
    || Boolean(lifecycle.reasoningText)
    || Boolean(lifecycle.error)
    || Boolean(lifecycle.usage)
    || Boolean(lifecycle.diagnostics);
}

function buildTurnStatusCard(
  lifecycle: AgentTurnLifecycleState,
): AgentDiagnosticsCardData {
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

function buildRuntimeAgentTurnsCard(lifecycle: AgentTurnLifecycleState): AgentDiagnosticsCardData | null {
  if (!lifecycle.runtimeAgentTurns) {
    return null;
  }
  return {
    key: 'turn-runtime-agent-turns',
    label: 'Runtime Anchor',
    value: lifecycle.runtimeAgentTurns.conversationAnchorId || 'Captured',
    detail: joinDetails([
      lifecycle.runtimeAgentTurns.runtimeTurnId
        ? `runtimeTurnId=${lifecycle.runtimeAgentTurns.runtimeTurnId}`
        : null,
      lifecycle.runtimeAgentTurns.runtimeStreamId
        ? `runtimeStreamId=${lifecycle.runtimeAgentTurns.runtimeStreamId}`
        : null,
      lifecycle.runtimeAgentTurns.route
        ? `route=${lifecycle.runtimeAgentTurns.route}`
        : null,
      lifecycle.runtimeAgentTurns.modelId
        ? `modelId=${lifecycle.runtimeAgentTurns.modelId}`
        : null,
      lifecycle.runtimeAgentTurns.connectorId
        ? `connectorId=${lifecycle.runtimeAgentTurns.connectorId}`
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
  if (!normalizeText(lifecycle.diagnostics?.requestPrompt) && !normalizeText(lifecycle.diagnostics?.requestSystemPrompt)) {
    return null;
  }
  return {
    key: 'turn-prompt',
    label: 'Prompt',
    value: 'Runtime redaction required',
    detail: 'Raw prompts are not rendered by Desktop diagnostics without Runtime-owned redacted replay evidence.',
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
    value: 'Runtime redaction required',
    detail: 'Raw provider output is not rendered by Desktop diagnostics without Runtime-owned redacted replay evidence.',
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
  recentRuntimeEvents: readonly NimiRuntimeAgentInspectEventSummary[];
  routeReady: boolean;
  runtimeInspect: NimiRuntimeAgentInspectSnapshot | null;
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
  const stateCards = buildAgentRuntimeStateCards(input);
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
      buildRuntimeAgentTurnsCard(lifecycle),
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
