import type {
  ConversationTurnError,
} from '@nimiplatform/kit/features/chat/headless';
import type {
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import { toConversationMessageViewModel } from './chat-agent-thread-model';

export function bundleQueryKey(threadId: string): readonly ['chat-agent-thread-bundle', string] {
  return ['chat-agent-thread-bundle', threadId];
}

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createAgentConversationCacheThreadId(localAgentRef: string): string {
  const normalizedLocalAgentRef = normalizeText(localAgentRef);
  if (!normalizedLocalAgentRef) {
    throw new Error('agent conversation cache thread id requires localAgentRef');
  }
  return `agent-thread:${normalizedLocalAgentRef}`;
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
