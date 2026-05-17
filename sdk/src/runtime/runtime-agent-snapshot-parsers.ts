import { asRecord, normalizeText } from './helpers.js';
import { parseTranscript } from './runtime-agent-transcript-parsers.js';
import type {
  RuntimeAgentExecutionBinding,
  RuntimeAgentPendingFollowUpSnapshot,
  RuntimeAgentReasoningConfig,
  RuntimeAgentSessionSnapshot,
  RuntimeAgentSessionTurnSnapshot,
} from './types-runtime-agent.js';
import { optionalContentString, optionalNumber, optionalString } from './runtime-agent-surface-parser-common.js';

function parseExecutionBinding(value: unknown): RuntimeAgentExecutionBinding | undefined {
  const payload = asRecord(value);
  const route = normalizeText(payload.route) as RuntimeAgentExecutionBinding['route'] | '';
  const modelId = normalizeText(payload.model_id);
  if (!route || !modelId) {
    return undefined;
  }
  const connectorId = normalizeText(payload.connector_id);
  return {
    route,
    modelId,
    ...(connectorId ? { connectorId } : {}),
  };
}
function parseReasoning(value: unknown): RuntimeAgentReasoningConfig | undefined {
  const payload = asRecord(value);
  const mode = normalizeText(payload.mode) as RuntimeAgentReasoningConfig['mode'] | '';
  const traceMode = normalizeText(payload.trace_mode) as RuntimeAgentReasoningConfig['traceMode'] | '';
  const budgetTokens = optionalNumber(payload.budget_tokens);
  if (!mode && !traceMode && budgetTokens === undefined) {
    return undefined;
  }
  return {
    ...(mode ? { mode } : {}),
    ...(traceMode ? { traceMode } : {}),
    ...(budgetTokens !== undefined ? { budgetTokens } : {}),
  };
}
function parseTrace(value: unknown): RuntimeAgentSessionTurnSnapshot['trace'] | undefined {
  const payload = asRecord(value);
  const traceId = optionalString(payload.trace_id);
  const modelResolved = optionalString(payload.model_resolved);
  const routeDecision = optionalString(payload.route_decision) as RuntimeAgentExecutionBinding['route'] | undefined;
  if (!traceId && !modelResolved && !routeDecision) {
    return undefined;
  }
  return {
    ...(traceId ? { traceId } : {}),
    ...(modelResolved ? { modelResolved } : {}),
    ...(routeDecision ? { routeDecision } : {}),
  };
}
function parseTurnSnapshot(value: unknown): RuntimeAgentSessionTurnSnapshot | undefined {
  const payload = asRecord(value);
  const turnId = optionalString(payload.turn_id);
  if (!turnId) {
    return undefined;
  }
  return {
    turnId,
    ...(optionalString(payload.stream_id) ? { streamId: optionalString(payload.stream_id) } : {}),
    ...(optionalString(payload.status) ? { status: optionalString(payload.status) } : {}),
    ...(optionalNumber(payload.stream_sequence) !== undefined ? { streamSequence: optionalNumber(payload.stream_sequence) } : {}),
    ...(optionalString(payload.turn_origin) ? { turnOrigin: optionalString(payload.turn_origin) } : {}),
    ...(optionalNumber(payload.follow_up_depth) !== undefined ? { followUpDepth: optionalNumber(payload.follow_up_depth) } : {}),
    ...(optionalNumber(payload.max_follow_up_turns) !== undefined ? { maxFollowUpTurns: optionalNumber(payload.max_follow_up_turns) } : {}),
    ...(typeof payload.output_observed === 'boolean' ? { outputObserved: payload.output_observed } : {}),
    ...(typeof payload.reasoning_observed === 'boolean' ? { reasoningObserved: payload.reasoning_observed } : {}),
    ...(optionalString(payload.updated_at) ? { updatedAt: optionalString(payload.updated_at) } : {}),
    ...(parseTrace(payload) ? { trace: parseTrace(payload) } : {}),
    ...(optionalString(payload.chain_id) ? { chainId: optionalString(payload.chain_id) } : {}),
    ...(optionalString(payload.source_turn_id) ? { sourceTurnId: optionalString(payload.source_turn_id) } : {}),
    ...(optionalString(payload.source_action_id) ? { sourceActionId: optionalString(payload.source_action_id) } : {}),
    ...(optionalString(payload.message_id) ? { messageId: optionalString(payload.message_id) } : {}),
    ...(optionalContentString(payload.text) !== undefined ? { text: optionalContentString(payload.text) } : {}),
    ...(Object.keys(asRecord(payload.structured)).length > 0 ? { structured: asRecord(payload.structured) } : {}),
    ...(Object.keys(asRecord(payload.assistant_memory)).length > 0 ? { assistantMemory: asRecord(payload.assistant_memory) } : {}),
    ...(Object.keys(asRecord(payload.chat_sidecar)).length > 0 ? { chatSidecar: asRecord(payload.chat_sidecar) } : {}),
    ...(Object.keys(asRecord(payload.follow_up)).length > 0 ? { followUp: asRecord(payload.follow_up) } : {}),
    ...(optionalString(payload.finish_reason) ? { finishReason: optionalString(payload.finish_reason) } : {}),
    ...(typeof payload.stream_simulated === 'boolean' ? { streamSimulated: payload.stream_simulated } : {}),
    ...(optionalString(payload.reason_code) ? { reasonCode: optionalString(payload.reason_code) } : {}),
    ...(optionalString(payload.action_hint) ? { actionHint: optionalString(payload.action_hint) } : {}),
    ...(optionalString(payload.message) ? { message: optionalString(payload.message) } : {}),
  };
}
function parsePendingFollowUp(value: unknown): RuntimeAgentPendingFollowUpSnapshot | undefined {
  const payload = asRecord(value);
  if (Object.keys(payload).length === 0) {
    return undefined;
  }
  return {
    ...(optionalString(payload.status) ? { status: optionalString(payload.status) } : {}),
    ...(optionalString(payload.follow_up_id) ? { followUpId: optionalString(payload.follow_up_id) } : {}),
    ...(optionalString(payload.scheduled_for) ? { scheduledFor: optionalString(payload.scheduled_for) } : {}),
    ...(optionalString(payload.chain_id) ? { chainId: optionalString(payload.chain_id) } : {}),
    ...(optionalNumber(payload.follow_up_depth) !== undefined ? { followUpDepth: optionalNumber(payload.follow_up_depth) } : {}),
    ...(optionalNumber(payload.max_follow_up_turns) !== undefined ? { maxFollowUpTurns: optionalNumber(payload.max_follow_up_turns) } : {}),
    ...(optionalString(payload.source_turn_id) ? { sourceTurnId: optionalString(payload.source_turn_id) } : {}),
    ...(optionalString(payload.source_action_id) ? { sourceActionId: optionalString(payload.source_action_id) } : {}),
  };
}
export function parseSessionSnapshot(value: unknown): RuntimeAgentSessionSnapshot {
  const payload = asRecord(value);
  return {
    ...(optionalString(payload.request_id) ? { requestId: optionalString(payload.request_id) } : {}),
    ...(optionalString(payload.thread_id) ? { threadId: optionalString(payload.thread_id) } : {}),
    ...(optionalString(payload.subject_user_id) ? { subjectUserId: optionalString(payload.subject_user_id) } : {}),
    ...(optionalString(payload.session_status) ? { sessionStatus: optionalString(payload.session_status) } : {}),
    ...(optionalNumber(payload.transcript_message_count) !== undefined
      ? { transcriptMessageCount: optionalNumber(payload.transcript_message_count) }
      : {}),
    ...(parseTranscript(payload.transcript) ? { transcript: parseTranscript(payload.transcript) } : {}),
    ...(parseExecutionBinding(payload.execution_binding) ? { executionBinding: parseExecutionBinding(payload.execution_binding) } : {}),
    ...(optionalString(payload.system_prompt) ? { systemPrompt: optionalString(payload.system_prompt) } : {}),
    ...(optionalNumber(payload.max_output_tokens) !== undefined ? { maxOutputTokens: optionalNumber(payload.max_output_tokens) } : {}),
    ...(parseReasoning(payload.reasoning) ? { reasoning: parseReasoning(payload.reasoning) } : {}),
    ...(parseTurnSnapshot(payload.active_turn) ? { activeTurn: parseTurnSnapshot(payload.active_turn) } : {}),
    ...(parseTurnSnapshot(payload.last_turn) ? { lastTurn: parseTurnSnapshot(payload.last_turn) } : {}),
    ...(parsePendingFollowUp(payload.pending_follow_up) ? { pendingFollowUp: parsePendingFollowUp(payload.pending_follow_up) } : {}),
  };
}
