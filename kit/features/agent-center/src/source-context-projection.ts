import type {
  AgentCenterAppManagerSnapshot,
  AgentCenterSourceContextProjection,
  AgentCenterSourceCoverageSummary,
  AgentCenterSourceProjectionSummary,
  AgentCenterTurnContextProjectionSummary,
} from './types.js';

const UNKNOWN_PROJECTION: AgentCenterSourceContextProjection = {
  status: 'unknown',
  source: null,
  context: null,
};

const FAILED_PROJECTION: AgentCenterSourceContextProjection = {
  status: 'failed',
  source: null,
  context: null,
};

function sourceCoverage(
  sections: readonly {
    readonly state: string;
    readonly requiredCount: number;
    readonly resolvedCount: number;
    readonly omittedCount: number;
  }[],
): AgentCenterSourceCoverageSummary {
  return sections.reduce<AgentCenterSourceCoverageSummary>((summary, section) => ({
    totalSections: summary.totalSections + 1,
    completeSections: summary.completeSections + (section.state === 'complete' ? 1 : 0),
    omittedSections: summary.omittedSections + (section.state === 'optional_omitted' ? 1 : 0),
    requiredItemCount: summary.requiredItemCount + section.requiredCount,
    resolvedItemCount: summary.resolvedItemCount + section.resolvedCount,
    omittedItemCount: summary.omittedItemCount + section.omittedCount,
  }), {
    totalSections: 0,
    completeSections: 0,
    omittedSections: 0,
    requiredItemCount: 0,
    resolvedItemCount: 0,
    omittedItemCount: 0,
  });
}

function managerTimestampToIso(
  value: { readonly seconds: string; readonly nanos: number } | null,
): string | null {
  if (!value) return null;
  const millis = (BigInt(value.seconds) * 1_000n) + BigInt(Math.floor(value.nanos / 1_000_000));
  const numeric = Number(millis);
  if (!Number.isSafeInteger(numeric)) return null;
  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function projectManagerSource(
  source: NonNullable<AgentCenterAppManagerSnapshot['source']>,
): AgentCenterSourceProjectionSummary {
  return {
    ready: source.ready,
    state: source.state,
    reasonCode: source.reasonCode,
    capturedAt: managerTimestampToIso(source.capturedAt),
    coverageSections: source.coverageSections.map((section) => ({ ...section })),
    coverage: sourceCoverage(source.coverageSections),
    lorebookReady: source.lorebookReady,
    lorebookItemCount: source.lorebookItemCount,
    lorebookEstimatedTokens: source.lorebookEstimatedTokens,
  };
}

function projectManagerContext(
  context: NonNullable<AgentCenterAppManagerSnapshot['context']>,
): AgentCenterTurnContextProjectionSummary {
  return {
    ready: context.ready,
    state: context.state,
    reasonCode: context.reasonCode,
    lanes: context.lanes.map((lane) => ({ ...lane })),
    budget: {
      inputBudgetTokens: context.inputBudgetTokens,
      usedTokens: context.usedTokens,
      requiredInputTokens: context.requiredInputTokens,
      requiredContextWindowTokens: context.requiredContextWindowTokens,
    },
    truncation: context.truncation.map((entry) => ({ ...entry })),
    transcriptTurnCount: context.transcriptTurnCount,
    memoryItemCount: context.memoryItemCount,
    mediaCount: context.mediaCount,
    toolCount: context.toolCount,
    sourceAdapterStatus: context.sourceAdapterStatus,
    sourceSelectionStatus: context.sourceSelectionStatus,
    conversationSummaryStatus: context.conversationSummaryStatus,
    privateRecallCount: context.privateRecallCount,
  };
}

// @nimi-authority: definition.nimi.platform.ui-design-system.runtime-projection
// @nimi-authority: rule.nimi.platform.ui-design-system.p-agent-center-002b
// @nimi-authority: rule.nimi.platform.ui-design-system.p-agent-center-006c
/** Projects only the SDK-decoded, identity-free covered-App Manager snapshot. */
export function projectAgentCenterManagerSourceContext(
  manager: AgentCenterAppManagerSnapshot | null | undefined,
): AgentCenterSourceContextProjection {
  if (!manager) return UNKNOWN_PROJECTION;
  const source = manager.source ? projectManagerSource(manager.source) : null;
  const context = manager.context ? projectManagerContext(manager.context) : null;
  if (!manager.source) return manager.context ? FAILED_PROJECTION : UNKNOWN_PROJECTION;
  if (!manager.source.ready) {
    if (manager.context?.ready) return FAILED_PROJECTION;
    return {
      status: manager.source.state === 'invalid' || manager.source.state === 'deleted' ? 'failed' : 'blocked',
      source,
      context: null,
    };
  }
  if (!manager.context || manager.context.state === 'not_composed') {
    return { status: 'unknown', source, context: null };
  }
  if (manager.context.state === 'invalid') return { status: 'failed', source, context };
  if (manager.context.state === 'context_capacity_exceeded') return { status: 'blocked', source, context };
  const truncated = manager.context.truncation.some((entry) => (
    entry.reason !== 'none' || entry.omittedItemCount > 0 || entry.truncatedItemCount > 0
  ));
  return { status: truncated ? 'truncated' : 'ready', source, context };
}
