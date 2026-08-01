import type {
  NimiRuntimeAgentConsumeEvent,
  NimiRuntimeAgentMessage,
  NimiRuntimeAgentSessionSnapshot,
  NimiRuntimeAgentTranscriptMessage,
} from '@nimiplatform/sdk/runtime';
import type {
  AgentLocalMessageRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
} from '../../bridge/runtime-bridge/types';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

type RuntimeAgentReplaySessionSnapshot = NimiRuntimeAgentSessionSnapshot & {
  readonly transcript?: readonly NimiRuntimeAgentMessage[];
};

function isTranscriptTextMessage(message: NimiRuntimeAgentMessage | null | undefined): boolean {
  const role = normalizeText(message?.role);
  const contentText = typeof message?.content === 'string' ? message.content : '';
  return (role === 'system' || role === 'user' || role === 'assistant')
    && contentText.length > 0;
}

function isTranscriptImageMessage(message: NimiRuntimeAgentMessage | null | undefined): boolean {
  const role = normalizeText(message?.role);
  return (role === 'user' || role === 'assistant')
    && normalizeText(message?.kind) === 'image'
    && Boolean(normalizeText(message?.artifactId));
}

function isTranscriptHydratableMessage(message: NimiRuntimeAgentMessage | null | undefined): boolean {
  return isTranscriptTextMessage(message) || isTranscriptImageMessage(message);
}

function isCommittedMediaProjectionMessage(message: AgentLocalMessageRecord): boolean {
  return message.status === 'complete'
    && !message.error
    && (
      message.kind === 'image'
      || message.kind === 'voice'
      || Boolean(normalizeText(message.mediaUrl))
      || Boolean(normalizeText(message.mediaMimeType))
      || Boolean(normalizeText(message.artifactId))
    );
}

function isCommittedTextProjectionMessage(message: AgentLocalMessageRecord): boolean {
  return message.status === 'complete'
    && !message.error
    && !isCommittedMediaProjectionMessage(message);
}

function locallyRetainedProjectionMessages(
  bundle: AgentLocalThreadBundle | null | undefined,
): AgentLocalMessageRecord[] {
  if (!bundle) {
    return [];
  }
  const messageById = new Map(bundle.messages.map((message) => [message.id, message]));
  const retainedIds = new Set(
    bundle.messages
      .filter((message) => message.status !== 'complete' || Boolean(message.error))
      .map((message) => message.id),
  );
  const pendingParentIds = [...retainedIds];
  while (pendingParentIds.length > 0) {
    const messageId = pendingParentIds.pop();
    const parentMessageId = messageId ? normalizeText(messageById.get(messageId)?.parentMessageId) : '';
    if (!parentMessageId || retainedIds.has(parentMessageId) || !messageById.has(parentMessageId)) {
      continue;
    }
    retainedIds.add(parentMessageId);
    pendingParentIds.push(parentMessageId);
  }
  return bundle.messages.filter((message) => retainedIds.has(message.id));
}

function parseIsoTimestampMs(value: unknown): number | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toMessageStatus(value: unknown): AgentLocalMessageRecord['status'] | null {
  const normalized = normalizeText(value);
  if (normalized === 'pending' || normalized === 'complete' || normalized === 'error') {
    return normalized;
  }
  return null;
}

function toMessageKind(value: unknown): AgentLocalMessageRecord['kind'] | null {
  const normalized = normalizeText(value);
  if (normalized === 'text' || normalized === 'image' || normalized === 'voice') {
    return normalized;
  }
  return null;
}

function hasRuntimeReplayEnvelope(message: NimiRuntimeAgentMessage | null | undefined): boolean {
  return Boolean(
    normalizeText(message?.id)
    && toMessageStatus(message?.status)
    && toMessageKind(message?.kind)
    && parseIsoTimestampMs(message?.createdAt) !== null
    && parseIsoTimestampMs(message?.updatedAt) !== null,
  );
}

function transcriptHasRuntimeReplayEnvelope(
  transcript: readonly NimiRuntimeAgentMessage[],
): transcript is readonly NimiRuntimeAgentTranscriptMessage[] {
  const replayMessages = transcript.filter(isTranscriptHydratableMessage);
  return replayMessages.length > 0 && replayMessages.every(hasRuntimeReplayEnvelope);
}

function toHydratedMessageRecord(input: {
  threadId: string;
  conversationAnchorId: string;
  transcript: readonly NimiRuntimeAgentTranscriptMessage[];
  index: number;
}): AgentLocalMessageRecord | null {
  const message = input.transcript[input.index];
  if (!message) {
    return null;
  }
  const role = normalizeText(message.role);
  const contentText = typeof message.content === 'string' ? message.content : '';
  const status = toMessageStatus(message.status);
  const kind = toMessageKind(message.kind);
  const artifactId = normalizeText(message.artifactId);
  const imageWithArtifact = kind === 'image' && Boolean(artifactId);
  if (
    (role !== 'system' && role !== 'user' && role !== 'assistant')
    || (contentText.length === 0 && !imageWithArtifact)
  ) {
    return null;
  }
  const createdAtMs = parseIsoTimestampMs(message.createdAt);
  const updatedAtMs = parseIsoTimestampMs(message.updatedAt);
  if (!status || !kind || createdAtMs === null || updatedAtMs === null) {
    return null;
  }
  return {
    id: message.id,
    threadId: input.threadId,
    role,
    status,
    kind,
    contentText,
    reasoningText: normalizeText(message.reasoningText) || null,
    error: null,
    traceId: normalizeText(message.traceId) || null,
    parentMessageId: normalizeText(message.parentMessageId) || null,
    mediaUrl: normalizeText(message.mediaUrl) || null,
    mediaMimeType: normalizeText(message.mediaMimeType) || null,
    artifactId: artifactId || null,
    metadataJson: message.metadata && Object.keys(message.metadata).length > 0 ? message.metadata : null,
    createdAtMs,
    updatedAtMs,
  };
}

function buildHydratedMessages(input: {
  threadId: string;
  conversationAnchorId: string;
  transcript: readonly NimiRuntimeAgentTranscriptMessage[];
  nowMs: number;
}): AgentLocalMessageRecord[] {
  return input.transcript.flatMap((message, index) => {
    const hydrated = toHydratedMessageRecord({
      threadId: input.threadId,
      conversationAnchorId: input.conversationAnchorId,
      transcript: input.transcript,
      index,
    });
    return hydrated ? [hydrated] : [];
  });
}

function transcriptMatchesBundle(
  transcript: readonly NimiRuntimeAgentMessage[],
  bundle: AgentLocalThreadBundle | null | undefined,
): boolean {
  if (!bundle) {
    return false;
  }
  const transcriptMessages = transcript.filter(isTranscriptTextMessage);
  const currentMessages = bundle.messages.filter(isCommittedTextProjectionMessage);
  if (currentMessages.length !== transcriptMessages.length) {
    return false;
  }
  const transcriptImageArtifactIds = transcript
    .filter(isTranscriptImageMessage)
    .map((message) => normalizeText(message.artifactId))
    .filter(Boolean);
  const currentImageArtifactIds = new Set(
    bundle.messages
      .filter((message) => isCommittedMediaProjectionMessage(message) && message.kind === 'image')
      .map((message) => normalizeText(message.artifactId))
      .filter(Boolean),
  );
  if (!transcriptImageArtifactIds.every((artifactId) => currentImageArtifactIds.has(artifactId))) {
    return false;
  }
  return currentMessages.every((message, index) => {
    const transcriptMessage = transcriptMessages[index];
    return normalizeText(message.role) === normalizeText(transcriptMessage?.role)
      && message.contentText === (typeof transcriptMessage?.content === 'string' ? transcriptMessage.content : '');
  });
}

function transcriptWouldDropCommittedAssistantText(
  transcript: readonly NimiRuntimeAgentMessage[],
  bundle: AgentLocalThreadBundle | null | undefined,
): boolean {
  if (!bundle) {
    return false;
  }
  const transcriptAssistantCount = transcript
    .filter(isTranscriptTextMessage)
    .filter((message) => normalizeText(message.role) === 'assistant')
    .length;
  const currentAssistantCount = bundle.messages
    .filter(isCommittedTextProjectionMessage)
    .filter((message) => normalizeText(message.role) === 'assistant')
    .length;
  return transcriptAssistantCount < currentAssistantCount;
}

function committedMediaProjectionMessages(
  bundle: AgentLocalThreadBundle | null | undefined,
): AgentLocalMessageRecord[] {
  if (!bundle) {
    return [];
  }
  return bundle.messages.filter(isCommittedMediaProjectionMessage);
}

function mergeHydratedTextAndLocalProjectionMessages(input: {
  hydratedMessages: AgentLocalMessageRecord[];
  committedMediaMessages: AgentLocalMessageRecord[];
  locallyRetainedMessages: AgentLocalMessageRecord[];
}): AgentLocalMessageRecord[] {
  if (
    input.committedMediaMessages.length === 0
    && input.locallyRetainedMessages.length === 0
  ) {
    return input.hydratedMessages;
  }
  const hydratedArtifactIds = new Set(
    input.hydratedMessages
      .map((message) => normalizeText(message.artifactId))
      .filter(Boolean),
  );
  const seenIds = new Set<string>();
  return [
    ...input.hydratedMessages,
    ...input.committedMediaMessages.filter((message) => {
      const artifactId = normalizeText(message.artifactId);
      return !artifactId || !hydratedArtifactIds.has(artifactId);
    }),
    ...input.locallyRetainedMessages,
  ]
    .filter((message) => {
      if (seenIds.has(message.id)) {
        return false;
      }
      seenIds.add(message.id);
      return true;
    })
    .map((message, index) => ({ message, index }))
    .sort((left, right) => (
      left.message.createdAtMs - right.message.createdAtMs
      || left.message.updatedAtMs - right.message.updatedAtMs
      || left.index - right.index
    ))
    .map((item) => item.message);
}

export function shouldRefreshAgentRuntimeSessionSnapshotForEvent(
  event: Pick<NimiRuntimeAgentConsumeEvent, 'eventName'>,
): boolean {
  return event.eventName === 'runtime.agent.turn.completed'
    || event.eventName === 'runtime.agent.turn.failed'
    || event.eventName === 'runtime.agent.turn.interrupted';
}

export function hydrateAgentThreadBundleFromRuntimeSessionSnapshot(input: {
  thread: AgentLocalThreadSummary | AgentLocalThreadRecord;
  bundle: AgentLocalThreadBundle | null | undefined;
  conversationAnchorId: string;
  snapshot: RuntimeAgentReplaySessionSnapshot;
  nowMs: number;
}): AgentLocalThreadBundle | null {
  const conversationAnchorId = normalizeText(input.conversationAnchorId);
  const transcript = Array.isArray(input.snapshot.transcript) ? input.snapshot.transcript : [];
  if (!conversationAnchorId || transcript.length === 0) {
    return null;
  }
  if (!transcriptHasRuntimeReplayEnvelope(transcript)) {
    return null;
  }
  if (transcriptWouldDropCommittedAssistantText(transcript, input.bundle)) {
    return null;
  }
  if (transcriptMatchesBundle(transcript, input.bundle)) {
    return null;
  }

  const hydratedMessages = buildHydratedMessages({
    threadId: input.thread.id,
    conversationAnchorId,
    transcript,
    nowMs: input.nowMs,
  });
  if (hydratedMessages.length === 0) {
    return null;
  }

  const messages = mergeHydratedTextAndLocalProjectionMessages({
    hydratedMessages,
    committedMediaMessages: committedMediaProjectionMessages(input.bundle),
    locallyRetainedMessages: locallyRetainedProjectionMessages(input.bundle),
  });
  const lastMessage = messages[messages.length - 1] || null;
  const createdAtMs = 'createdAtMs' in input.thread && typeof input.thread.createdAtMs === 'number'
    ? input.thread.createdAtMs
    : input.bundle?.thread.createdAtMs || input.nowMs;
  const updatedAtMs = Math.max(
    input.thread.updatedAtMs,
    lastMessage?.updatedAtMs || input.nowMs,
  );
  return {
    thread: {
      ...input.thread,
      createdAtMs,
      updatedAtMs,
      lastMessageAtMs: lastMessage?.updatedAtMs || input.thread.lastMessageAtMs,
    },
    messages,
  };
}
