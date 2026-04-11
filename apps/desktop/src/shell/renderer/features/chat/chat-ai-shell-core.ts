import type {
  ConversationRuntimeTextStreamPart,
  ConversationTurnError,
  ConversationTurnHistoryMessage,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type {
  ChatAiDraftRecord,
  ChatAiMessageRecord,
  ChatAiThreadBundle,
  ChatAiThreadRecord,
  ChatAiThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import { toConversationMessageViewModel } from './chat-ai-thread-model';

export const THREADS_QUERY_KEY = ['chat-ai-threads'];

export function bundleQueryKey(threadId: string): readonly ['chat-ai-thread-bundle', string] {
  return ['chat-ai-thread-bundle', threadId];
}

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * If `text` is a beat-action JSON envelope produced by the output contract,
 * extract the human-readable beat text. Otherwise return unchanged.
 *
 * This guards the simple-ai path against envelopes that leaked into stored
 * messages (from before the output contract was removed) or that a model
 * emits spontaneously after seeing envelope-shaped history.
 */
export function stripBeatActionEnvelopeIfPresent(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return text;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (
      parsed.schemaId === 'nimi.agent.chat.beat-action.v1'
      && Array.isArray(parsed.beats)
    ) {
      const extracted = (parsed.beats as Array<{ text?: unknown }>)
        .map((beat) => normalizeText(beat.text))
        .filter(Boolean)
        .join('\n\n');
      return extracted || text;
    }
  } catch {
    // Not valid JSON — return as-is.
  }
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
): ConversationTurnHistoryMessage[] {
  return messages.flatMap((message) => {
    if (message.status !== 'complete') {
      return [];
    }
    const viewModel = toConversationMessageViewModel(message);
    const text = normalizeText(viewModel.text);
    if (!text) {
      return [];
    }
    if (
      message.role !== 'system'
      && message.role !== 'user'
      && message.role !== 'assistant'
      && message.role !== 'tool'
    ) {
      return [];
    }
    return [{
      id: message.id,
      role: message.role,
      text: message.role === 'assistant' ? stripBeatActionEnvelopeIfPresent(text) : text,
    }];
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
  part: ConversationRuntimeTextStreamPart,
  promptTraceId: string,
): ConversationRuntimeTextStreamPart {
  if (part.type !== 'finish' && part.type !== 'error') {
    return part;
  }
  return {
    ...part,
    trace: {
      ...(part.trace || {}),
      promptTraceId: normalizeText(promptTraceId) || part.trace?.promptTraceId || null,
    },
  };
}
