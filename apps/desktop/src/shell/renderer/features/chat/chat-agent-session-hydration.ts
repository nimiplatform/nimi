import type {
  RuntimeAgentMessage,
  RuntimeAgentSessionSnapshot,
} from '@nimiplatform/sdk/runtime';
import type {
  AgentLocalMessageRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isTranscriptTextMessage(message: RuntimeAgentMessage | null | undefined): boolean {
  const role = normalizeText(message?.role);
  const contentText = typeof message?.content === 'string' ? message.content : '';
  return (role === 'system' || role === 'user' || role === 'assistant')
    && contentText.length > 0;
}

function isCommittedMediaProjectionMessage(message: AgentLocalMessageRecord): boolean {
  return message.status !== 'pending'
    && (
      message.kind === 'image'
      || message.kind === 'voice'
      || Boolean(normalizeText(message.mediaUrl))
      || Boolean(normalizeText(message.mediaMimeType))
      || Boolean(normalizeText(message.artifactId))
    );
}

function isCommittedTextProjectionMessage(message: AgentLocalMessageRecord): boolean {
  return message.status !== 'pending' && !isCommittedMediaProjectionMessage(message);
}

function parseIsoTimestampMs(value: unknown): number | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toMessageStatus(value: unknown): AgentLocalMessageRecord['status'] {
  const normalized = normalizeText(value);
  if (normalized === 'pending' || normalized === 'complete' || normalized === 'error') {
    return normalized;
  }
  return 'complete';
}

function toMessageKind(value: unknown): AgentLocalMessageRecord['kind'] {
  const normalized = normalizeText(value);
  if (normalized === 'image' || normalized === 'voice') {
    return normalized;
  }
  return 'text';
}

function toHydratedMessageRecord(input: {
  threadId: string;
  conversationAnchorId: string;
  transcript: readonly RuntimeAgentMessage[];
  index: number;
  createdAtMs: number;
}): AgentLocalMessageRecord | null {
  const message = input.transcript[input.index];
  if (!message) {
    return null;
  }
  const role = normalizeText(message.role);
  const contentText = typeof message.content === 'string' ? message.content : '';
  if (
    (role !== 'system' && role !== 'user' && role !== 'assistant')
    || contentText.length === 0
  ) {
    return null;
  }
  const previous = input.index > 0 ? input.transcript[input.index - 1] : null;
  const parentMessageId = role === 'assistant'
    && previous
    && normalizeText(previous.role) === 'user'
      ? `${input.conversationAnchorId}:session:${input.index - 1}`
      : null;
  const createdAtMs = parseIsoTimestampMs(message.createdAt) ?? input.createdAtMs;
  const updatedAtMs = parseIsoTimestampMs(message.updatedAt) ?? createdAtMs;
  return {
    id: normalizeText(message.id) || `${input.conversationAnchorId}:session:${input.index}`,
    threadId: input.threadId,
    role,
    status: toMessageStatus(message.status),
    kind: toMessageKind(message.kind),
    contentText,
    reasoningText: normalizeText(message.reasoningText) || null,
    error: null,
    traceId: normalizeText(message.traceId) || null,
    parentMessageId: normalizeText(message.parentMessageId) || parentMessageId,
    mediaUrl: normalizeText(message.mediaUrl) || null,
    mediaMimeType: normalizeText(message.mediaMimeType) || null,
    artifactId: normalizeText(message.artifactId) || null,
    metadataJson: message.metadata && Object.keys(message.metadata).length > 0 ? message.metadata : null,
    createdAtMs,
    updatedAtMs,
  };
}

function buildHydratedMessages(input: {
  threadId: string;
  conversationAnchorId: string;
  transcript: readonly RuntimeAgentMessage[];
  nowMs: number;
}): AgentLocalMessageRecord[] {
  const baseCreatedAtMs = input.nowMs - Math.max(input.transcript.length - 1, 0);
  return input.transcript.flatMap((message, index) => {
    const hydrated = toHydratedMessageRecord({
      threadId: input.threadId,
      conversationAnchorId: input.conversationAnchorId,
      transcript: input.transcript,
      index,
      createdAtMs: baseCreatedAtMs + index,
    });
    return hydrated ? [hydrated] : [];
  });
}

function transcriptMatchesBundle(
  transcript: readonly RuntimeAgentMessage[],
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
  return currentMessages.every((message, index) => {
    const transcriptMessage = transcriptMessages[index];
    return normalizeText(message.role) === normalizeText(transcriptMessage?.role)
      && message.contentText === (typeof transcriptMessage?.content === 'string' ? transcriptMessage.content : '');
  });
}

function transcriptWouldDropCommittedAssistantText(
  transcript: readonly RuntimeAgentMessage[],
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

function mergeHydratedTextAndCommittedMediaMessages(input: {
  hydratedMessages: AgentLocalMessageRecord[];
  committedMediaMessages: AgentLocalMessageRecord[];
}): AgentLocalMessageRecord[] {
  if (input.committedMediaMessages.length === 0) {
    return input.hydratedMessages;
  }
  const seenIds = new Set<string>();
  return [
    ...input.hydratedMessages,
    ...input.committedMediaMessages,
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

export function hydrateAgentThreadBundleFromRuntimeSessionSnapshot(input: {
  thread: AgentLocalThreadSummary | AgentLocalThreadRecord;
  bundle: AgentLocalThreadBundle | null | undefined;
  conversationAnchorId: string;
  snapshot: RuntimeAgentSessionSnapshot;
  nowMs: number;
}): AgentLocalThreadBundle | null {
  const conversationAnchorId = normalizeText(input.conversationAnchorId);
  const transcript = Array.isArray(input.snapshot.transcript) ? input.snapshot.transcript : [];
  if (!conversationAnchorId || transcript.length === 0) {
    return null;
  }
  if (!input.bundle) {
    return null;
  }
  if (input.bundle?.messages.some((message) => message.status === 'pending')) {
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

  const messages = mergeHydratedTextAndCommittedMediaMessages({
    hydratedMessages,
    committedMediaMessages: committedMediaProjectionMessages(input.bundle),
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
    draft: input.bundle?.draft || null,
  };
}
