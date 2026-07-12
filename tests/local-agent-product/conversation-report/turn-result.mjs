function text(value) {
  return String(value || '').trim();
}

function firstText(values) {
  return (Array.isArray(values) ? values : []).map(text).find(Boolean) || '';
}

export function resolveConversationTurnOutcome({
  snapshot,
  outputText,
  uiState,
  uiReasonCode,
  uiMessage,
  runtimeTurnId,
  pageErrors = [],
  consoleErrors = [],
}) {
  const lastTurn = snapshot?.lastTurn || {};
  const response = text(outputText);
  const status = text(lastTurn.status).toLowerCase();
  const failed = Boolean(text(lastTurn.reasonCode)) || status === 'failed' || text(uiState).toLowerCase() === 'failed';
  if (!failed && response) {
    return { status: 'completed', outputText: response, transportFailure: null };
  }
  if (!failed) {
    throw new Error('turn produced neither a completed assistant response nor a terminal transport failure');
  }
  const reasonCode = text(lastTurn.reasonCode) || text(uiReasonCode) || 'TRANSPORT_FAILURE';
  const message = text(lastTurn.message)
    || text(uiMessage)
    || firstText(pageErrors)
    || firstText(consoleErrors)
    || `Runtime turn failed (${reasonCode})`;
  return {
    status: 'transport_failure',
    outputText: '',
    transportFailure: {
      stage: text(runtimeTurnId) ? 'runtime_turn' : 'before_runtime_turn',
      reasonCode,
      message,
    },
  };
}

export function conversationReportExecutionStatus(turns) {
  return (Array.isArray(turns) ? turns : []).some((turn) => turn?.transportFailure)
    ? 'completed_with_transport_failure'
    : 'completed';
}
