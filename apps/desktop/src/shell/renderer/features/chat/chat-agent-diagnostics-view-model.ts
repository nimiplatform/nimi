import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
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

function formatUsage(input: AgentTurnLifecycleState['usage']): string | null {
  if (!input) {
    return null;
  }
  const details: string[] = [];
  if (Number.isFinite(Number(input.inputTokens))) {
    details.push(`inputTokens=${Number(input.inputTokens)}`);
  }
  if (Number.isFinite(Number(input.outputTokens))) {
    details.push(`outputTokens=${Number(input.outputTokens)}`);
  }
  return details.length > 0 ? details.join(' · ') : null;
}

function hasRecentTurn(lifecycle: AgentTurnLifecycleState | null): boolean {
  if (!lifecycle) {
    return false;
  }
  return lifecycle.terminal !== 'running'
    || Boolean(lifecycle.traceId)
    || Boolean(lifecycle.promptTraceId)
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

function buildFinishCard(lifecycle: AgentTurnLifecycleState): AgentDiagnosticsCardData {
  return {
    key: 'turn-finish',
    label: 'Finish',
    value: lifecycle.diagnostics?.finishReason || '-',
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
  return {
    key: 'turn-budget',
    label: 'Budget',
    value: diagnostics?.contextWindowSource || '-',
    detail: joinDetails([
      diagnostics
        ? `maxOutputTokensRequested=${diagnostics.maxOutputTokensRequested ?? '-'}`
        : null,
      diagnostics ? `promptOverflow=${diagnostics.promptOverflow}` : null,
    ]),
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

export function buildAgentDiagnosticsViewModel(input: {
  activeTarget: AgentLocalTargetSnapshot | null;
  lifecycle: AgentTurnLifecycleState | null;
  routeReady: boolean;
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
  if (!hasRecentTurn(input.lifecycle)) {
    return {
      runtimeCard,
      turnCards: [],
      emptyLabel: 'No recent agent turn diagnostics yet.',
    };
  }
  const lifecycle = input.lifecycle!;
  return {
    runtimeCard,
    turnCards: [
      buildTurnStatusCard(lifecycle),
      buildTraceCard(lifecycle),
      buildFinishCard(lifecycle),
      buildOutputCard(lifecycle),
      buildBudgetCard(lifecycle),
      buildImageCard(lifecycle),
      buildPromptCard(lifecycle),
      buildReturnDataCard(lifecycle),
    ].filter(Boolean) as AgentDiagnosticsCardData[],
    emptyLabel: null,
  };
}
