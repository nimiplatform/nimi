import type {
  ConversationTurnError,
  ConversationTurnHistoryMessage,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type {
  AgentLocalDraftRecord,
  AgentLocalMessageRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import { toConversationMessageViewModel } from './chat-agent-thread-model';

export const THREADS_QUERY_KEY = ['chat-agent-threads'];
export const TARGETS_QUERY_KEY = ['chat-agent-friends'];

export function bundleQueryKey(threadId: string): readonly ['chat-agent-thread-bundle', string] {
  return ['chat-agent-thread-bundle', threadId];
}

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function sortThreadSummaries(
  threads: readonly AgentLocalThreadSummary[],
): AgentLocalThreadSummary[] {
  return [...threads].sort((left, right) => {
    const timeDelta = right.updatedAtMs - left.updatedAtMs;
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.id.localeCompare(right.id);
  });
}

export function upsertThreadSummary(
  threads: readonly AgentLocalThreadSummary[],
  nextThread: AgentLocalThreadSummary,
): AgentLocalThreadSummary[] {
  const filtered = threads.filter((thread) => thread.id !== nextThread.id);
  filtered.push(nextThread);
  return sortThreadSummaries(filtered);
}

export function upsertBundleDraft(
  bundle: AgentLocalThreadBundle | null | undefined,
  draft: AgentLocalDraftRecord | null,
): AgentLocalThreadBundle | null | undefined {
  if (!bundle) {
    return bundle;
  }
  return {
    ...bundle,
    draft,
  };
}

export function toErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || fallback);
}

function normalizeReasoningText(value: unknown): string {
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
  messages: readonly AgentLocalMessageRecord[],
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
      text,
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
