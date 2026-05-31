import type {
  ConversationMessageViewModel,
  ConversationThreadSummary,
} from '@nimiplatform/kit/features/chat/headless';
import type {
  ChatAiMessageContent,
  ChatAiMessageError,
  ChatAiMessageRecord,
  ChatAiThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';

export const AI_NEW_CONVERSATION_TITLE = 'New conversation';
const AI_THREAD_TITLE_MAX_LENGTH = 80;

function toIsoString(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function hasAiConversationThread(
  threads: readonly ChatAiThreadSummary[],
  threadId: string | null | undefined,
): boolean {
  const normalizedThreadId = normalizeText(threadId);
  if (!normalizedThreadId) {
    return false;
  }
  return threads.some((thread) => thread.id === normalizedThreadId);
}

export function resolveAiConversationActiveThreadId(input: {
  threads: readonly ChatAiThreadSummary[];
  selectionThreadId: string | null | undefined;
  lastSelectedThreadId: string | null | undefined;
}): string | null {
  if (hasAiConversationThread(input.threads, input.selectionThreadId)) {
    return normalizeText(input.selectionThreadId);
  }
  if (hasAiConversationThread(input.threads, input.lastSelectedThreadId)) {
    return normalizeText(input.lastSelectedThreadId);
  }
  return null;
}

export function toConversationThreadSummary(
  thread: ChatAiThreadSummary,
): ConversationThreadSummary {
  return {
    id: thread.id,
    mode: 'ai',
    title: thread.title,
    previewText: '',
    createdAt: toIsoString(thread.updatedAtMs),
    updatedAt: toIsoString(thread.updatedAtMs),
    unreadCount: 0,
    status: 'active',
    pinned: false,
    targetId: 'ai',
    targetLabel: 'AI',
  };
}

function toContentText(contentText: string, content: ChatAiMessageContent): string {
  const normalizedContentText = String(contentText || '');
  if (normalizedContentText) {
    return normalizedContentText;
  }
  return content.parts
    .map((part: ChatAiMessageContent['parts'][number]) => String(part.text || ''))
    .join('\n')
    .trim();
}

function toErrorMessage(error: ChatAiMessageError | null): string | null {
  if (!error) {
    return null;
  }
  return normalizeText(error.message) || normalizeText(error.code) || 'Message failed';
}

export function toConversationMessageViewModel(
  message: ChatAiMessageRecord,
): ConversationMessageViewModel {
  const reasoningText = typeof message.content.metadata.reasoningText === 'string'
    ? message.content.metadata.reasoningText
    : null;
  return {
    id: message.id,
    threadId: message.threadId,
    role: message.role,
    text: toContentText(message.contentText, message.content),
    createdAt: toIsoString(message.createdAtMs),
    updatedAt: toIsoString(message.updatedAtMs),
    status: message.status,
    error: toErrorMessage(message.error),
    metadata: {
      traceId: message.traceId,
      parentMessageId: message.parentMessageId,
      reasoningText,
    },
  };
}

export function createPlainTextMessageContent(text: string): ChatAiMessageContent {
  return {
    parts: [{ type: 'text', text }],
    toolCalls: [],
    attachments: [],
    metadata: {},
  };
}

export function createAssistantMessageContent(text: string, reasoningText?: string | null): ChatAiMessageContent {
  const normalizedReasoningText = String(reasoningText || '').trim();
  return {
    parts: [{ type: 'text', text }],
    toolCalls: [],
    attachments: [],
    metadata: normalizedReasoningText
      ? { reasoningText: normalizedReasoningText }
      : {},
  };
}

export function trimThreadTitleFromUserMessage(text: string): string {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return AI_NEW_CONVERSATION_TITLE;
  }
  return normalized.slice(0, AI_THREAD_TITLE_MAX_LENGTH);
}

export function resolveThreadTitleAfterFirstSend(currentTitle: string, userText: string): string {
  if (normalizeText(currentTitle) !== AI_NEW_CONVERSATION_TITLE) {
    return currentTitle;
  }
  return trimThreadTitleFromUserMessage(userText);
}
