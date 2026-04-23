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
  return {
    id: `${input.conversationAnchorId}:session:${input.index}`,
    threadId: input.threadId,
    role,
    status: 'complete',
    kind: 'text',
    contentText,
    reasoningText: null,
    error: null,
    traceId: null,
    parentMessageId,
    mediaUrl: null,
    mediaMimeType: null,
    artifactId: null,
    metadataJson: null,
    createdAtMs: input.createdAtMs,
    updatedAtMs: input.createdAtMs,
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
  const currentMessages = bundle.messages.filter((message) => message.status !== 'pending');
  if (currentMessages.length !== transcript.length) {
    return false;
  }
  return currentMessages.every((message, index) => {
    const transcriptMessage = transcript[index];
    return normalizeText(message.role) === normalizeText(transcriptMessage?.role)
      && message.contentText === (typeof transcriptMessage?.content === 'string' ? transcriptMessage.content : '');
  });
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
  if (input.bundle?.messages.some((message) => message.status === 'pending')) {
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

  const lastMessage = hydratedMessages[hydratedMessages.length - 1] || null;
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
    messages: hydratedMessages,
    draft: input.bundle?.draft || null,
  };
}
