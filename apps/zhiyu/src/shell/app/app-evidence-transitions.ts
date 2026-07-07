import type {
  RuntimeAgentConversationProjectionState,
} from '@nimiplatform/kit/features/chat/headless';
import type {
  ZhiyuEvidence,
  ZhiyuRuntimeAgentChatStatus,
} from './evidence';
import { runZhiyuAgentChatTurn } from '../agent-chat/runtime-agent-turn-adapter';

export function chatStatusFromSubmitRefreshFailure({
  current,
  conversation,
  route,
  turn,
}: {
  readonly current: ZhiyuRuntimeAgentChatStatus;
  readonly conversation: ZhiyuEvidence['conversation'];
  readonly route: ZhiyuEvidence['route'];
  readonly turn: ZhiyuEvidence['turn'];
}): ZhiyuRuntimeAgentChatStatus {
  const routeBlocked = !route.ready;
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'failed',
    reasonCode: routeBlocked
      ? 'zhiyu-submit-route-refresh-stale'
      : 'zhiyu-submit-turn-refresh-blocked',
    actionHint: routeBlocked
      ? route.actionHint || 'configure_runtime_agent_ai_config'
      : turn.actionHint || 'resolve_runtime_agent_binding',
    source: routeBlocked ? route.source : turn.source,
    message: routeBlocked
      ? `Runtime route changed before submit. ${route.message}`
      : `Runtime Agent turn channel became unavailable before submit. ${turn.message}`,
    ownerUserId: conversation.ownerUserId,
    runtimeSourceRef: conversation.runtimeSourceRef,
    localAgentRef: conversation.localAgentRef,
    conversationAnchorId: conversation.conversationAnchorId,
    requestId: null,
    eventTypes: [],
    messageCount: current.messages.length,
    messages: current.messages,
    latestAssistantText: current.latestAssistantText,
    reasoningText: null,
    outputText: null,
    diagnostics: current.diagnostics,
  };
}

export function appendSubmittedUserMessage(
  current: ZhiyuRuntimeAgentChatStatus,
  conversation: ZhiyuEvidence['conversation'],
  requestId: string,
  text: string,
): ZhiyuRuntimeAgentChatStatus {
  return ensureSubmittedUserMessageInChat({
    ...current,
    ownerUserId: conversation.ownerUserId ?? current.ownerUserId,
    runtimeSourceRef: conversation.runtimeSourceRef ?? current.runtimeSourceRef,
    localAgentRef: conversation.localAgentRef ?? current.localAgentRef,
    conversationAnchorId: conversation.conversationAnchorId ?? current.conversationAnchorId,
    requestId,
  }, conversation, requestId, text);
}

export function ensureSubmittedUserMessageInChat(
  status: ZhiyuRuntimeAgentChatStatus,
  conversation: ZhiyuEvidence['conversation'],
  requestId: string | null,
  text: string,
): ZhiyuRuntimeAgentChatStatus {
  const turnId = requestId?.trim();
  if (!turnId || !conversation.conversationAnchorId || !conversation.localAgentRef || !text.trim()) {
    return status;
  }
  const hasSubmittedUserMessage = status.messages.some((message) =>
    message.role === 'user'
    && message.text === text
    && conversationMessageTurnId(message) === turnId,
  );
  if (hasSubmittedUserMessage) {
    return status;
  }
  const submittedUserMessage = createSubmittedUserMessage({
    conversation,
    requestId: turnId,
    text,
    createdAt: new Date().toISOString(),
  });
  const insertBeforeAssistantIndex = status.messages.findIndex((message) =>
    conversationMessageTurnId(message) === turnId
    && (message.role === 'agent' || message.role === 'assistant'),
  );
  const insertIndex = insertBeforeAssistantIndex >= 0 ? insertBeforeAssistantIndex : status.messages.length;
  const messages = [
    ...status.messages.slice(0, insertIndex),
    submittedUserMessage,
    ...status.messages.slice(insertIndex),
  ];
  return {
    ...status,
    messageCount: messages.length,
    messages,
  };
}

export function chatStatusFromProjection(
  projection: RuntimeAgentConversationProjectionState,
  identity?: Pick<ZhiyuEvidence['conversation'], 'ownerUserId' | 'runtimeSourceRef' | 'localAgentRef' | 'conversationAnchorId'>,
): ZhiyuRuntimeAgentChatStatus {
  const latestAssistant = latestAssistantMessage(projection.messages);
  return {
    transport: 'electron-ipc',
    ready: projection.status === 'completed',
    state: projection.status,
    reasonCode: projection.reasonCode,
    actionHint: projection.status === 'completed'
      ? 'review_runtime_agent_chat_message'
      : 'inspect_runtime_agent_chat_stream',
    source: 'runtime',
    message: projection.message,
    ownerUserId: identity?.ownerUserId ?? null,
    runtimeSourceRef: identity?.runtimeSourceRef ?? null,
    localAgentRef: projection.localAgentRef || identity?.localAgentRef || null,
    conversationAnchorId: projection.conversationAnchorId || identity?.conversationAnchorId || null,
    requestId: projection.turnId,
    eventTypes: projection.events.map((event) => event.type),
    messageCount: projection.messages.length,
    messages: projection.messages,
    latestAssistantText: latestAssistant?.text || null,
    reasoningText: projection.reasoningText || null,
    outputText: projection.outputText || null,
    diagnostics: projection.diagnostics,
  };
}

export function chatStatusFromResult(
  result: Awaited<ReturnType<typeof runZhiyuAgentChatTurn>>,
): ZhiyuRuntimeAgentChatStatus {
  const latestAssistant = latestAssistantMessage(result.messages);
  return {
    transport: 'electron-ipc',
    ready: result.ready,
    state: result.state,
    reasonCode: result.reasonCode,
    actionHint: result.actionHint,
    source: result.source,
    message: result.message,
    ownerUserId: result.ownerUserId,
    runtimeSourceRef: result.runtimeSourceRef,
    localAgentRef: result.localAgentRef,
    conversationAnchorId: result.conversationAnchorId,
    requestId: result.requestId,
    eventTypes: result.events.map((event) => event.type),
    messageCount: result.messages.length,
    messages: result.messages,
    latestAssistantText: latestAssistant?.text || result.outputText,
    reasoningText: result.reasoningText,
    outputText: result.outputText,
    diagnostics: result.diagnostics,
  };
}

export function createZhiyuTurnRequestId(): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `zhiyu-turn-${randomId}`;
}

export function mergeChatTranscript(
  current: ZhiyuRuntimeAgentChatStatus,
  incoming: ZhiyuRuntimeAgentChatStatus,
): ZhiyuRuntimeAgentChatStatus {
  if (
    !current.conversationAnchorId
    || !incoming.conversationAnchorId
    || current.conversationAnchorId !== incoming.conversationAnchorId
    || current.messages.length === 0
  ) {
    return incoming;
  }
  const messages = mergeConversationMessages(current.messages, incoming.messages);
  const latestAssistant = latestAssistantMessage(messages);
  return {
    ...incoming,
    messageCount: messages.length,
    messages,
    latestAssistantText: latestAssistant?.text || incoming.latestAssistantText,
  };
}

export function turnStatusFromChat(chat: ZhiyuRuntimeAgentChatStatus): ZhiyuEvidence['turn'] {
  const latestAssistant = latestAssistantMessage(chat.messages);
  return {
    transport: 'electron-ipc',
    ready: chat.ready,
    reasonCode: chat.reasonCode,
    actionHint: chat.actionHint,
    source: chat.source,
    message: chat.message,
    ownerUserId: chat.ownerUserId,
    runtimeSourceRef: chat.runtimeSourceRef,
    localAgentRef: chat.localAgentRef,
    conversationAnchorId: chat.conversationAnchorId,
    requestId: chat.requestId,
    messageId: latestAssistant?.id ?? null,
  };
}

export function cancelStreamingChatMessages(
  messages: RuntimeAgentConversationProjectionState['messages'],
): RuntimeAgentConversationProjectionState['messages'] {
  const canceledAt = new Date().toISOString();
  return messages.map((message) => {
    if (message.status !== 'streaming' && message.kind !== 'streaming') {
      return message;
    }
    return {
      ...message,
      text: message.text || '当前回复已停止。',
      updatedAt: canceledAt,
      status: 'canceled' as const,
      kind: 'text' as const,
      error: '当前回复已停止。',
      metadata: {
        ...(message.metadata || {}),
        interrupted: true,
        interruptReason: 'runtime-agent-chat-user-canceled',
      },
    };
  });
}

function createSubmittedUserMessage(input: {
  readonly conversation: ZhiyuEvidence['conversation'];
  readonly requestId: string;
  readonly text: string;
  readonly createdAt: string;
}): RuntimeAgentConversationProjectionState['messages'][number] {
  const conversationAnchorId = input.conversation.conversationAnchorId;
  const localAgentRef = input.conversation.localAgentRef;
  if (!conversationAnchorId || !localAgentRef) {
    throw new Error('Zhiyu submitted user message requires Runtime conversation identity.');
  }
  return {
    id: `${input.requestId}:user`,
    sessionId: conversationAnchorId,
    targetId: localAgentRef,
    source: 'agent',
    role: 'user',
    text: input.text,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    status: 'complete',
    kind: 'text',
    senderName: 'You',
    senderKind: 'human',
    metadata: {
      modeId: 'runtime-agent-chat-v1',
      threadId: conversationAnchorId,
      turnId: input.requestId,
      sessionId: conversationAnchorId,
      targetId: localAgentRef,
      conversationAnchorId,
      localAgentRef,
    },
  };
}

function mergeConversationMessages(
  currentMessages: RuntimeAgentConversationProjectionState['messages'],
  incomingMessages: RuntimeAgentConversationProjectionState['messages'],
): RuntimeAgentConversationProjectionState['messages'] {
  const merged: Array<RuntimeAgentConversationProjectionState['messages'][number]> = [];
  const indexByMessageKey = new Map<string, number>();
  const usedIds = new Set<string>();
  const append = (message: RuntimeAgentConversationProjectionState['messages'][number]) => {
    const normalized = normalizeMergedConversationMessage(message, usedIds);
    const key = mergedConversationMessageKey(normalized);
    indexByMessageKey.set(key, merged.length);
    usedIds.add(normalized.id);
    merged.push(normalized);
  };
  for (const message of currentMessages) {
    append(message);
  }
  for (const message of incomingMessages) {
    const key = mergedConversationMessageKey(message);
    const existingIndex = indexByMessageKey.get(key);
    if (existingIndex === undefined) {
      append(message);
    } else {
      const existing = merged[existingIndex];
      merged[existingIndex] = preserveMergedConversationMessageId(existing, message);
    }
  }
  return merged.filter((message) => !isEmptyStreamingTranscriptPlaceholder(message));
}

function normalizeMergedConversationMessage(
  message: RuntimeAgentConversationProjectionState['messages'][number],
  usedIds: Set<string>,
): RuntimeAgentConversationProjectionState['messages'][number] {
  if (!usedIds.has(message.id)) {
    return message;
  }
  const originalMessageId = originalConversationMessageId(message);
  const turnId = conversationMessageTurnId(message);
  return {
    ...message,
    id: turnId ? `${turnId}:${originalMessageId}` : `${message.id}:${usedIds.size}`,
    metadata: {
      ...(message.metadata || {}),
      zhiyuOriginalMessageId: originalMessageId,
    },
  };
}

function preserveMergedConversationMessageId(
  existing: RuntimeAgentConversationProjectionState['messages'][number],
  incoming: RuntimeAgentConversationProjectionState['messages'][number],
): RuntimeAgentConversationProjectionState['messages'][number] {
  if (existing.id === incoming.id) {
    return incoming;
  }
  return {
    ...incoming,
    id: existing.id,
    metadata: {
      ...(incoming.metadata || {}),
      zhiyuOriginalMessageId: originalConversationMessageId(incoming),
    },
  };
}

function mergedConversationMessageKey(
  message: RuntimeAgentConversationProjectionState['messages'][number],
): string {
  const turnId = conversationMessageTurnId(message);
  const originalMessageId = originalConversationMessageId(message);
  return turnId ? `${turnId}:${originalMessageId}` : originalMessageId;
}

function originalConversationMessageId(
  message: RuntimeAgentConversationProjectionState['messages'][number],
): string {
  const original = message.metadata?.zhiyuOriginalMessageId;
  return typeof original === 'string' && original.trim() ? original : message.id;
}

function conversationMessageTurnId(
  message: RuntimeAgentConversationProjectionState['messages'][number],
): string | null {
  const turnId = message.metadata?.turnId;
  return typeof turnId === 'string' && turnId.trim() ? turnId : null;
}

function isEmptyStreamingTranscriptPlaceholder(
  message: RuntimeAgentConversationProjectionState['messages'][number],
): boolean {
  const streaming = message.kind === 'streaming' || message.status === 'streaming';
  return streaming && typeof message.text === 'string' && message.text.trim().length === 0;
}

function latestAssistantMessage(
  messages: RuntimeAgentConversationProjectionState['messages'],
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && (message.role === 'agent' || message.role === 'assistant')) {
      return message;
    }
  }
  return null;
}
