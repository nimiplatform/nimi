import type { Struct } from '../core-generated/runtime-protobuf/google/protobuf/struct';
import { fromNimiRuntimeProtoStruct } from './runtime-agent-values';
import {
  asRecord,
  optionalNumber,
  optionalString,
} from './runtime-agent-consume-internal';
import type {
  NimiRuntimeAgentSessionSnapshot,
  NimiRuntimeAgentSessionTranscriptMessage,
  NimiRuntimeAgentSessionTurnSnapshot,
} from './runtime-agent-consume-types';
import {
  assertNimiRuntimeAgentContextProjectionCorrelation,
  decodeNimiRuntimeAgentTurnContextSummary,
} from './runtime-agent-context-projections';

export function parseNimiRuntimeAgentSessionSnapshot(
  value?: Struct,
  expected: {
    readonly localAgentRef?: string;
    readonly conversationAnchorId?: string;
  } = {},
): NimiRuntimeAgentSessionSnapshot {
  const payload = value ? fromNimiRuntimeProtoStruct(value) : {};
  const transcript = parseTranscript(payload.transcript);
  const activeTurn = parseTurnSnapshot(payload.active_turn ?? payload.activeTurn, expected);
  const lastTurn = parseTurnSnapshot(payload.last_turn ?? payload.lastTurn, expected);
  return {
    ...(optionalString(payload.request_id, payload.requestId) ? { requestId: optionalString(payload.request_id, payload.requestId) } : {}),
    ...(optionalString(payload.thread_id, payload.threadId) ? { threadId: optionalString(payload.thread_id, payload.threadId) } : {}),
    ...(optionalString(payload.subject_user_id, payload.subjectUserId) ? { subjectUserId: optionalString(payload.subject_user_id, payload.subjectUserId) } : {}),
    ...(optionalString(payload.session_status, payload.sessionStatus) ? { sessionStatus: optionalString(payload.session_status, payload.sessionStatus) } : {}),
    ...(optionalNumber(payload.transcript_message_count ?? payload.transcriptMessageCount) !== undefined
      ? { transcriptMessageCount: optionalNumber(payload.transcript_message_count ?? payload.transcriptMessageCount) }
      : {}),
    ...(transcript ? { transcript } : {}),
    ...(optionalNumber(payload.config_revision ?? payload.configRevision) !== undefined
      ? { configRevision: optionalNumber(payload.config_revision ?? payload.configRevision) }
      : {}),
    ...(asRecord(payload.execution_bindings ?? payload.executionBindings) ? { executionBindings: asRecord(payload.execution_bindings ?? payload.executionBindings) } : {}),
    ...(activeTurn ? { activeTurn } : {}),
    ...(lastTurn ? { lastTurn } : {}),
    ...(asRecord(payload.pending_follow_up ?? payload.pendingFollowUp) ? { pendingFollowUp: asRecord(payload.pending_follow_up ?? payload.pendingFollowUp) } : {}),
  };
}

function parseTranscript(value: unknown): NimiRuntimeAgentSessionTranscriptMessage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const transcript: NimiRuntimeAgentSessionTranscriptMessage[] = [];
  for (const item of value) {
    const payload = asRecord(item);
    if (!payload) return undefined;
    const id = optionalString(payload.id);
    const role = optionalString(payload.role);
    const content = optionalContentString(payload.content);
    const name = optionalString(payload.name);
    const status = optionalString(payload.status);
    const kind = optionalString(payload.kind);
    const createdAt = optionalString(payload.created_at, payload.createdAt);
    const updatedAt = optionalString(payload.updated_at, payload.updatedAt);
    const parentMessageId = optionalString(payload.parent_message_id, payload.parentMessageId);
    const traceId = optionalString(payload.trace_id, payload.traceId);
    const reasoningText = optionalContentString(payload.reasoning_text ?? payload.reasoningText);
    const mediaUrl = optionalString(payload.media_url, payload.mediaUrl);
    const mediaMimeType = optionalString(payload.media_mime_type, payload.mediaMimeType);
    const artifactId = optionalString(payload.artifact_id, payload.artifactId);
    const metadata = asRecord(payload.metadata);
    if (
      !id
      || !isRuntimeAgentTranscriptRole(role)
      || content === undefined
      || !isRuntimeAgentTranscriptStatus(status)
      || !isRuntimeAgentTranscriptKind(kind)
      || !isValidIsoTimestamp(createdAt)
      || !isValidIsoTimestamp(updatedAt)
    ) {
      return undefined;
    }
    transcript.push({
      id,
      role,
      content,
      ...(name ? { name } : {}),
      status,
      kind,
      createdAt,
      updatedAt,
      ...(parentMessageId ? { parentMessageId } : {}),
      ...(traceId ? { traceId } : {}),
      ...(reasoningText !== undefined ? { reasoningText } : {}),
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(mediaMimeType ? { mediaMimeType } : {}),
      ...(artifactId ? { artifactId } : {}),
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    });
  }
  return transcript.length > 0 ? transcript : undefined;
}

function parseTurnSnapshot(
  value: unknown,
  expected: {
    readonly localAgentRef?: string;
    readonly conversationAnchorId?: string;
  },
): NimiRuntimeAgentSessionTurnSnapshot | undefined {
  const payload = asRecord(value);
  if (!payload) return undefined;
  const turnId = optionalString(payload.turn_id, payload.turnId);
  if (!turnId) return undefined;
  const rawContextSummary = payload.context_summary ?? payload.contextSummary;
  const contextSummary = rawContextSummary === undefined || rawContextSummary === null
    ? undefined
    : decodeNimiRuntimeAgentTurnContextSummary(rawContextSummary);
  if (contextSummary) {
    assertNimiRuntimeAgentContextProjectionCorrelation({
      turnContextSummary: contextSummary,
      expectedLocalAgentRef: expected.localAgentRef,
      expectedConversationAnchorId: expected.conversationAnchorId,
      expectedTurnId: turnId,
    });
  }
  return {
    turnId,
    ...(optionalString(payload.stream_id, payload.streamId) ? { streamId: optionalString(payload.stream_id, payload.streamId) } : {}),
    ...(optionalString(payload.status) ? { status: optionalString(payload.status) } : {}),
    ...(optionalNumber(payload.stream_sequence ?? payload.streamSequence) !== undefined ? { streamSequence: optionalNumber(payload.stream_sequence ?? payload.streamSequence) } : {}),
    ...(optionalString(payload.turn_origin, payload.turnOrigin) ? { turnOrigin: optionalString(payload.turn_origin, payload.turnOrigin) } : {}),
    ...(optionalNumber(payload.follow_up_depth ?? payload.followUpDepth) !== undefined ? { followUpDepth: optionalNumber(payload.follow_up_depth ?? payload.followUpDepth) } : {}),
    ...(optionalNumber(payload.max_follow_up_turns ?? payload.maxFollowUpTurns) !== undefined ? { maxFollowUpTurns: optionalNumber(payload.max_follow_up_turns ?? payload.maxFollowUpTurns) } : {}),
    ...(typeof payload.output_observed === 'boolean' ? { outputObserved: payload.output_observed } : {}),
    ...(typeof payload.outputObserved === 'boolean' ? { outputObserved: payload.outputObserved } : {}),
    ...(typeof payload.reasoning_observed === 'boolean' ? { reasoningObserved: payload.reasoning_observed } : {}),
    ...(typeof payload.reasoningObserved === 'boolean' ? { reasoningObserved: payload.reasoningObserved } : {}),
    ...(optionalString(payload.updated_at, payload.updatedAt) ? { updatedAt: optionalString(payload.updated_at, payload.updatedAt) } : {}),
    ...(optionalString(payload.message_id, payload.messageId) ? { messageId: optionalString(payload.message_id, payload.messageId) } : {}),
    ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
    ...(asRecord(payload.structured) ? { structured: asRecord(payload.structured) } : {}),
    ...(optionalString(payload.finish_reason, payload.finishReason) ? { finishReason: optionalString(payload.finish_reason, payload.finishReason) } : {}),
    ...(optionalString(payload.reason_code, payload.reasonCode) ? { reasonCode: optionalString(payload.reason_code, payload.reasonCode) } : {}),
    ...(optionalString(payload.action_hint, payload.actionHint) ? { actionHint: optionalString(payload.action_hint, payload.actionHint) } : {}),
    ...(optionalString(payload.message) ? { message: optionalString(payload.message) } : {}),
    ...(contextSummary ? { contextSummary } : {}),
  };
}

function optionalContentString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRuntimeAgentTranscriptRole(
  value: string | undefined,
): value is NimiRuntimeAgentSessionTranscriptMessage['role'] {
  return value === 'system' || value === 'user' || value === 'assistant' || value === 'tool';
}

function isRuntimeAgentTranscriptStatus(
  value: string | undefined,
): value is NimiRuntimeAgentSessionTranscriptMessage['status'] {
  return value === 'pending'
    || value === 'complete'
    || value === 'error'
    || value === 'committed'
    || value === 'failed';
}

function isRuntimeAgentTranscriptKind(
  value: string | undefined,
): value is NimiRuntimeAgentSessionTranscriptMessage['kind'] {
  return value === 'text'
    || value === 'image'
    || value === 'voice'
    || value === 'tool'
    || value === 'system';
}

function isValidIsoTimestamp(value: string | undefined): value is string {
  return Boolean(value && Number.isFinite(Date.parse(value)));
}
