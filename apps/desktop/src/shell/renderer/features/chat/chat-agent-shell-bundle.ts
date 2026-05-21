import type {
  AgentLocalDraftRecord,
  AgentLocalMessageError,
  AgentLocalMessageRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '@renderer/bridge/runtime-bridge/types';

export function replaceAgentBundleMessage(
  messages: readonly AgentLocalMessageRecord[],
  nextMessage: AgentLocalMessageRecord,
): AgentLocalMessageRecord[] {
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

export function createEmptyAgentThreadBundle(
  thread: AgentLocalThreadRecord,
): AgentLocalThreadBundle {
  return {
    thread,
    messages: [],
    draft: null,
  };
}

/**
 * Build the ordinary first-message-floor opening assistant message for a new
 * AgentFriend thread from the RealmAgent's stored `greeting`.
 *
 * This is a generic mechanic keyed purely on the ordinary
 * `AgentLocalTargetSnapshot.greeting` field — it applies to ANY RealmAgent
 * that carries a non-empty greeting and contains no guide-specific identifier
 * or branch. The greeting is carried VERBATIM as a complete assistant message
 * (it is not produced by a runtime turn). Returns `null` when the RealmAgent
 * carries no greeting, so a greeting-less RealmAgent simply opens with an
 * empty thread.
 */
export function buildAgentGreetingSeedMessage(input: {
  threadId: string;
  greeting: string | null | undefined;
  createdAtMs: number;
}): AgentLocalMessageRecord | null {
  const greeting = String(input.greeting || '').trim();
  if (!greeting) {
    return null;
  }
  return {
    id: `${input.threadId}:message:greeting`,
    threadId: input.threadId,
    role: 'assistant',
    status: 'complete',
    kind: 'text',
    contentText: greeting,
    reasoningText: null,
    error: null,
    traceId: null,
    parentMessageId: null,
    mediaUrl: null,
    mediaMimeType: null,
    artifactId: null,
    metadataJson: null,
    createdAtMs: input.createdAtMs,
    updatedAtMs: input.createdAtMs,
  };
}

export function resolveAuthoritativeAgentThreadBundle(input: {
  optimisticBundle: AgentLocalThreadBundle | null | undefined;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  clearDraft: boolean;
}): AgentLocalThreadBundle | null {
  const base = input.refreshedBundle || input.optimisticBundle || null;
  if (!base) {
    return null;
  }
  if (!input.clearDraft || base.draft === null) {
    return base;
  }
  return {
    ...base,
    draft: null,
  };
}

export function resolveCompletedAgentThreadBundle(input: {
  optimisticBundle: AgentLocalThreadBundle | null | undefined;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
}): AgentLocalThreadBundle | null {
  return resolveAuthoritativeAgentThreadBundle({
    optimisticBundle: input.optimisticBundle,
    refreshedBundle: input.refreshedBundle,
    clearDraft: true,
  });
}

export function overlayAgentAssistantVisibleState(input: {
  bundle: AgentLocalThreadBundle | null | undefined;
  fallbackThread: AgentLocalThreadRecord;
  assistantMessageId: string;
  assistantPlaceholder: AgentLocalMessageRecord;
  partialText: string;
  partialReasoningText: string;
  updatedAtMs: number;
}): AgentLocalThreadBundle {
  const base = input.bundle || createEmptyAgentThreadBundle(input.fallbackThread);
  const assistantMessage = base.messages.find((message) => message.id === input.assistantMessageId);
  const existingIsAuthoritative = assistantMessage?.status === 'complete';
  const nextContentText = existingIsAuthoritative && assistantMessage?.contentText
    ? assistantMessage.contentText
    : input.partialText || assistantMessage?.contentText || '';
  const nextReasoningText = existingIsAuthoritative && assistantMessage?.reasoningText
    ? assistantMessage.reasoningText
    : input.partialReasoningText || assistantMessage?.reasoningText || null;

  return {
    ...base,
    messages: assistantMessage
      ? replaceAgentBundleMessage(base.messages, {
        ...assistantMessage,
        contentText: nextContentText,
        reasoningText: nextReasoningText,
        updatedAtMs: input.updatedAtMs,
      })
      : replaceAgentBundleMessage(base.messages, {
        ...input.assistantPlaceholder,
        contentText: input.partialText,
        reasoningText: input.partialReasoningText || null,
        updatedAtMs: input.updatedAtMs,
      }),
  };
}

export function overlayAgentAssistantTerminalState(input: {
  bundle: AgentLocalThreadBundle | null | undefined;
  fallbackThread: AgentLocalThreadRecord;
  assistantMessageId: string;
  assistantPlaceholder: AgentLocalMessageRecord;
  partialText: string;
  partialReasoningText: string;
  runtimeError: AgentLocalMessageError;
  traceId: string | null;
  draft: AgentLocalDraftRecord;
  updatedAtMs: number;
}): AgentLocalThreadBundle {
  const base = input.bundle || createEmptyAgentThreadBundle(input.fallbackThread);
  const assistantMessage = base.messages.find((message) => message.id === input.assistantMessageId);

  return {
    ...base,
    messages: assistantMessage
      ? replaceAgentBundleMessage(base.messages, {
        ...assistantMessage,
        contentText: assistantMessage.contentText || input.partialText,
        reasoningText: assistantMessage.reasoningText || input.partialReasoningText || null,
        error: assistantMessage.error || input.runtimeError,
        traceId: assistantMessage.traceId || input.traceId,
        updatedAtMs: input.updatedAtMs,
      })
      : replaceAgentBundleMessage(base.messages, {
        ...input.assistantPlaceholder,
        contentText: input.partialText,
        reasoningText: input.partialReasoningText || null,
        error: input.runtimeError,
        traceId: input.traceId,
        updatedAtMs: input.updatedAtMs,
      }),
    draft: input.draft,
  };
}

export function resolveInterruptedAgentThreadBundle(input: {
  optimisticBundle: AgentLocalThreadBundle | null | undefined;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  fallbackThread: AgentLocalThreadRecord;
  assistantMessageId: string;
  assistantPlaceholder: AgentLocalMessageRecord;
  partialText: string;
  partialReasoningText: string;
  runtimeError: AgentLocalMessageError;
  traceId: string | null;
  draft: AgentLocalDraftRecord;
  updatedAtMs: number;
}): AgentLocalThreadBundle {
  const authoritativeBundle = resolveAuthoritativeAgentThreadBundle({
    optimisticBundle: input.optimisticBundle,
    refreshedBundle: input.refreshedBundle,
    clearDraft: false,
  });
  return overlayAgentAssistantTerminalState({
    bundle: authoritativeBundle,
    fallbackThread: input.fallbackThread,
    assistantMessageId: input.assistantMessageId,
    assistantPlaceholder: input.assistantPlaceholder,
    partialText: input.partialText,
    partialReasoningText: input.partialReasoningText,
    runtimeError: input.runtimeError,
    traceId: input.traceId,
    draft: input.draft,
    updatedAtMs: input.updatedAtMs,
  });
}
