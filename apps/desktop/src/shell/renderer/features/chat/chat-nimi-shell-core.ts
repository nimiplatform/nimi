import type { ConversationTurnError } from '@nimiplatform/kit/features/chat/headless';
import {
  buildNimiConversationHistoryMessages,
  type NimiConversationMessage,
} from '@nimiplatform/sdk/features/conversation';
import type { NimiRunEvent } from '@nimiplatform/sdk/contracts';
import type {
  ChatAiDraftRecord,
  ChatAiMessageRecord,
  ChatAiThreadBundle,
  ChatAiThreadRecord,
  ChatAiThreadSummary,
} from '../../bridge/runtime-bridge/types';
import { toConversationMessageViewModel } from './chat-nimi-thread-model';

export const THREADS_QUERY_KEY = ['chat-ai-threads'];

export function bundleQueryKey(threadId: string): readonly ['chat-ai-thread-bundle', string] {
  return ['chat-ai-thread-bundle', threadId];
}

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function stripBeatActionEnvelopeIfPresent(text: string): string {
  return text;
}

export function sortThreadSummaries(threads: readonly ChatAiThreadSummary[]): ChatAiThreadSummary[] {
  return [...threads].sort((left, right) => {
    const timeDelta = right.updatedAtMs - left.updatedAtMs;
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.id.localeCompare(right.id);
  });
}

export function upsertThreadSummary(
  threads: readonly ChatAiThreadSummary[],
  nextThread: ChatAiThreadSummary,
): ChatAiThreadSummary[] {
  const filtered = threads.filter((thread) => thread.id !== nextThread.id);
  filtered.push(nextThread);
  return sortThreadSummaries(filtered);
}

export function replaceMessage(
  messages: readonly ChatAiMessageRecord[],
  nextMessage: ChatAiMessageRecord,
): ChatAiMessageRecord[] {
  const filtered = messages.filter((message) => message.id !== nextMessage.id);
  filtered.push(nextMessage);
  return [...filtered].sort((left, right) => {
    const timeDelta = left.createdAtMs - right.createdAtMs;
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.id.localeCompare(right.id);
  });
}

export function upsertBundleDraft(
  bundle: ChatAiThreadBundle | null | undefined,
  draft: ChatAiDraftRecord | null,
): ChatAiThreadBundle | null | undefined {
  if (!bundle) {
    return bundle;
  }
  return {
    ...bundle,
    draft,
  };
}

export function createEmptyBundle(thread: ChatAiThreadRecord): ChatAiThreadBundle {
  return {
    thread,
    messages: [],
    draft: null,
  };
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || 'Unknown error');
}

export function normalizeReasoningText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isEmptyPendingAssistantMessage(
  message: ReturnType<typeof toConversationMessageViewModel>,
): boolean {
  if (message.role !== 'assistant' || message.status !== 'pending') {
    return false;
  }
  return !message.text.trim() && !normalizeReasoningText(message.metadata?.reasoningText) && !message.error;
}

export function toConversationHistoryMessages(
  messages: readonly ChatAiMessageRecord[],
): readonly NimiConversationMessage[] {
  return buildNimiConversationHistoryMessages({
    messages,
    isCommitted: (message) => message.status === 'complete',
    getId: (message) => message.id,
    getRole: (message) => message.role,
    getText: (message) => toConversationMessageViewModel(message).text,
    mapAssistantText: (text) => stripBeatActionEnvelopeIfPresent(text),
  });
}

export function toAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function toStructuredProviderError(error: ConversationTurnError): Error {
  const nextError = new Error(error.message);
  nextError.name = error.code || 'RUNTIME_CALL_FAILED';
  (nextError as Error & { reasonCode?: string }).reasonCode = error.code;
  return nextError;
}

export function withPromptTrace(
  part: NimiRunEvent,
  promptTraceId: string,
): NimiRunEvent {
  if (part.type !== 'trace' && part.type !== 'error') {
    return part;
  }
  const normalizedPromptTraceId = normalizeText(promptTraceId);
  if (part.type === 'error') {
    return {
      ...part,
      cause: Object.assign(
        part.cause && typeof part.cause === 'object' ? part.cause : {},
        {
        promptTraceId: normalizedPromptTraceId
          || (part.cause as Record<string, unknown> | undefined)?.promptTraceId
          || null,
        },
      ),
    };
  }
  return {
    ...part,
    trace: {
      ...(part.trace || {}),
      promptTraceId: normalizedPromptTraceId
        || (part.trace as typeof part.trace & { promptTraceId?: string | null }).promptTraceId
        || null,
    } as typeof part.trace & { promptTraceId?: string | null },
  } as NimiRunEvent;
}
