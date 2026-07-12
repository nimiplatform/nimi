const LIVE_SAFE_STATUSES = Object.freeze(['ready', 'truncated']);
const CORE_SAFE_STATUSES = Object.freeze(['ready']);

export function admittedAgentCenterSourceContextStatuses(conversationReport) {
  return conversationReport ? LIVE_SAFE_STATUSES : CORE_SAFE_STATUSES;
}

export function assertAgentCenterSourceContextProjection({
  status,
  conversationReport,
  turnContextSummary,
}) {
  const admitted = admittedAgentCenterSourceContextStatuses(conversationReport);
  if (!admitted.includes(status)) {
    throw new Error(`Desktop Agent Center source/context status ${String(status)} is not admitted for this Journey`);
  }
  if (!conversationReport) return;
  if (turnContextSummary?.ready !== true || turnContextSummary?.state !== 'ready') {
    throw new Error('Desktop conversation report Agent Center status requires a ready typed Runtime turn context summary');
  }
  if (status !== 'truncated') return;
  const aggregate = turnContextSummary.truncation?.[0];
  const hasBoundedTruncation = aggregate
    && (aggregate.reason !== 'none'
      || Number(aggregate.omittedItemCount || 0) > 0
      || Number(aggregate.truncatedItemCount || 0) > 0);
  if (!hasBoundedTruncation) {
    throw new Error('Desktop Agent Center truncated status requires a non-empty typed Runtime truncation aggregate');
  }
}
