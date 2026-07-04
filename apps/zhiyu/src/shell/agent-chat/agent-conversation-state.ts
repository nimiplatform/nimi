import type {
  NimiRuntimeAgentConsumeEvent,
  NimiRuntimeAgentSessionSnapshot,
  NimiRuntimeAgentSessionTranscriptMessage,
} from '@nimiplatform/sdk/runtime';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat';
import type { ZhiyuEvidence } from '../app/evidence';

export type ZhiyuAgentChatStatus = ZhiyuEvidence['chat'];
export type ZhiyuCompanionStatus = ZhiyuEvidence['companion'];

export type ZhiyuAgentSessionHydrationInput = {
  readonly current: ZhiyuAgentChatStatus;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
  readonly snapshot: NimiRuntimeAgentSessionSnapshot;
};

export function hydrateZhiyuAgentChatFromRuntimeSessionSnapshot(
  input: ZhiyuAgentSessionHydrationInput,
): ZhiyuAgentChatStatus {
  const transcript = Array.isArray(input.snapshot.transcript) ? input.snapshot.transcript : [];
  if (!transcriptHasReplayEnvelope(transcript)) {
    return input.current;
  }
  const messages = transcript.flatMap((message) => {
    const projected = transcriptMessageToCanonicalMessage({
      message,
      sessionId: input.conversationAnchorId,
      targetId: input.localAgentRef,
    });
    return projected ? [projected] : [];
  });
  if (messages.length === 0) {
    return input.current;
  }
  const latestAssistant = latestAssistantMessage(messages);
  const outputText = latestAssistant?.text || null;
  return {
    transport: 'electron-ipc',
    ready: true,
    state: 'completed',
    reasonCode: 'runtime-agent-session-snapshot-hydrated',
    actionHint: 'continue_runtime_agent_conversation',
    source: 'runtime',
    message: 'Runtime Agent session snapshot was hydrated through SDK transcript replay.',
    ownerUserId: input.ownerUserId,
    runtimeSourceRef: input.runtimeSourceRef,
    localAgentRef: input.localAgentRef,
    conversationAnchorId: input.conversationAnchorId,
    requestId: normalizeText(input.snapshot.requestId) || null,
    eventTypes: ['session-snapshot-hydrated'],
    messageCount: messages.length,
    messages,
    latestAssistantText: outputText,
    reasoningText: latestAssistant?.metadata?.reasoningText as string | undefined || null,
    outputText,
    diagnostics: {
      source: 'runtime.agent.session.snapshot',
      transcriptMessageCount: messages.length,
      sessionStatus: normalizeText(input.snapshot.sessionStatus) || 'unknown',
    },
  };
}

export function projectZhiyuCompanionFromRuntimeAgentEvent(input: {
  readonly current: ZhiyuCompanionStatus;
  readonly event: NimiRuntimeAgentConsumeEvent;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly observedAt?: string;
}): ZhiyuCompanionStatus {
  if (!input.event.eventName.startsWith('runtime.agent.state.')) {
    return input.current;
  }
  const observedAt = normalizeText(input.observedAt) || new Date().toISOString();
  const detail = input.event.detail || {};
  const statusText = normalizeText(detail.currentStatusText) || input.current.statusText;
  const executionState = normalizeText(detail.currentExecutionState) || input.current.executionState;
  const currentEmotion = normalizeText(detail.currentEmotion) || input.current.currentEmotion;
  const activeWorldId = normalizeText(detail.activeWorldId) || input.current.activeWorldId;
  const activeUserId = normalizeText(detail.activeUserId) || input.current.activeUserId;
  const hasPosture = Boolean(detail.currentPosture && typeof detail.currentPosture === 'object');
  const projectedFields = uniqueTexts([
    ...input.current.projectedFields,
    'runtimeAgentEventSubscription',
    statusText ? 'statusText' : '',
    executionState ? 'executionState' : '',
    currentEmotion ? 'currentEmotion' : '',
    activeWorldId ? 'activeWorldId' : '',
    activeUserId ? 'activeUserId' : '',
    hasPosture ? 'currentPosture' : '',
  ]);
  return {
    ...input.current,
    transport: 'electron-ipc',
    ready: true,
    state: 'projected',
    reasonCode: 'runtime-agent-state-event-projected',
    actionHint: 'inspect_runtime_agent_state_event_subscription',
    source: 'runtime',
    message: 'Runtime Agent state event was projected through SDK event subscription.',
    ownerUserId: input.ownerUserId,
    runtimeSourceRef: input.runtimeSourceRef,
    localAgentRef: input.event.localAgentRef || input.current.localAgentRef,
    observedAt,
    stateUpdatedAt: observedAt,
    executionState,
    statusText,
    activeWorldId,
    activeUserId,
    currentEmotion,
    participationMode: activeWorldId ? 'world' : activeUserId ? 'dyadic' : 'idle',
    participationSource: activeWorldId || activeUserId || 'runtime-agent-event',
    projectedFields,
  };
}

function transcriptHasReplayEnvelope(
  transcript: readonly NimiRuntimeAgentSessionTranscriptMessage[],
): boolean {
  return transcript.length > 0 && transcript.every((message) => (
    normalizeText(message.id)
    && normalizeText(message.role)
    && normalizeText(message.content)
    && normalizeText(message.status)
    && normalizeText(message.kind)
    && normalizeText(message.createdAt)
    && normalizeText(message.updatedAt)
  ));
}

function transcriptMessageToCanonicalMessage(input: {
  readonly message: NimiRuntimeAgentSessionTranscriptMessage;
  readonly sessionId: string;
  readonly targetId: string;
}): ConversationCanonicalMessage | null {
  const id = normalizeText(input.message.id);
  const content = normalizeText(input.message.content);
  if (!id || !content) {
    return null;
  }
  const role = canonicalRole(input.message.role);
  const kind = canonicalKind(input.message.kind);
  const status = canonicalStatus(input.message.status);
  const createdAt = normalizeText(input.message.createdAt);
  const updatedAt = normalizeText(input.message.updatedAt) || createdAt;
  if (!role || !kind || !status || !createdAt) {
    return null;
  }
  return {
    id,
    sessionId: input.sessionId,
    targetId: input.targetId,
    source: 'agent',
    role,
    text: content,
    createdAt,
    updatedAt,
    status,
    kind,
    senderName: role === 'user' ? 'You' : role === 'agent' ? 'Zhiyu Agent' : null,
    senderKind: role === 'user' ? 'human' : role === 'agent' ? 'agent' : 'system',
    metadata: {
      ...(normalizeText(input.message.traceId) ? { traceId: normalizeText(input.message.traceId) } : {}),
      ...(normalizeText(input.message.reasoningText) ? { reasoningText: normalizeText(input.message.reasoningText) } : {}),
      ...(input.message.metadata || {}),
    },
  };
}

function canonicalRole(role: unknown): ConversationCanonicalMessage['role'] | null {
  const normalized = normalizeText(role);
  if (normalized === 'assistant') {
    return 'agent';
  }
  if (normalized === 'user' || normalized === 'system' || normalized === 'tool') {
    return normalized;
  }
  return null;
}

function canonicalKind(kind: unknown): ConversationCanonicalMessage['kind'] | null {
  const normalized = normalizeText(kind);
  if (
    normalized === 'text'
    || normalized === 'image'
    || normalized === 'voice'
    || normalized === 'system'
  ) {
    return normalized;
  }
  if (normalized === 'tool') {
    return 'system';
  }
  return null;
}

function canonicalStatus(status: unknown): ConversationCanonicalMessage['status'] | null {
  const normalized = normalizeText(status);
  if (normalized === 'complete' || normalized === 'pending' || normalized === 'error') {
    return normalized;
  }
  if (normalized === 'committed') {
    return 'complete';
  }
  if (normalized === 'failed') {
    return 'error';
  }
  return null;
}

function latestAssistantMessage(messages: readonly ConversationCanonicalMessage[]): ConversationCanonicalMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'agent') {
      return message;
    }
  }
  return null;
}

function uniqueTexts(values: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
