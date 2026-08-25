import type {
  RuntimeAgentConversationProjectionState,
} from '@nimiplatform/kit/features/chat/headless';
import type {
  ZhiyuEvidence,
  ZhiyuRuntimeAgentChatStatus,
} from './evidence';
import type { runZhiyuAgentChatTurn } from '../agent-chat/runtime-agent-turn-adapter';
import { zhiyuConversationActionKey } from '../agent-chat/agent-conversation-state';

export function chatStatusFromSubmitRefreshFailure({
  current,
  conversation,
  turn,
}: {
  readonly current: ZhiyuRuntimeAgentChatStatus;
  readonly conversation: ZhiyuEvidence['conversation'];
  readonly turn: ZhiyuEvidence['turn'];
}): ZhiyuRuntimeAgentChatStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'failed',
    reasonCode: 'zhiyu-submit-turn-refresh-blocked',
    actionHint: turn.actionHint || 'refresh_runtime_local_agent_inventory',
    source: turn.source,
    message: `The direct local-app conversation became unavailable before submit. ${turn.message}`,
    ownerUserId: conversation.ownerUserId,
    runtimeSourceRef: conversation.runtimeSourceRef,
    localAgentRef: conversation.localAgentRef,
    conversationAnchorId: conversation.conversationAnchorId,
    requestId: null,
    runtimeTurnId: current.runtimeTurnId,
    runtimeStreamId: current.runtimeStreamId,
    eventTypes: [],
    messageCount: current.messages.length,
    messages: current.messages,
		actions: current.actions,
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
  createdAt: string,
): ZhiyuRuntimeAgentChatStatus {
  return ensureSubmittedUserMessageInChat({
    ...current,
    ownerUserId: conversation.ownerUserId ?? current.ownerUserId,
    runtimeSourceRef: conversation.runtimeSourceRef ?? current.runtimeSourceRef,
    localAgentRef: conversation.localAgentRef ?? current.localAgentRef,
    conversationAnchorId: conversation.conversationAnchorId ?? current.conversationAnchorId,
    requestId,
    runtimeTurnId: null,
    runtimeStreamId: null,
  }, conversation, requestId, text, createdAt);
}

export function ensureSubmittedUserMessageInChat(
  status: ZhiyuRuntimeAgentChatStatus,
  conversation: ZhiyuEvidence['conversation'],
  requestId: string | null,
  text: string,
  createdAt: string,
): ZhiyuRuntimeAgentChatStatus {
  const turnId = requestId?.trim();
  if (!turnId || !conversation.conversationAnchorId || !conversation.agentHandle
    || !text.trim()) {
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
    createdAt,
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
  const runtimeIdentity = runtimeTurnIdentityFromProjection(projection);
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
    runtimeTurnId: runtimeIdentity.runtimeTurnId,
    runtimeStreamId: runtimeIdentity.runtimeStreamId,
    eventTypes: projection.events.map((event) => event.type),
    messageCount: projection.messages.length,
    messages: projection.messages,
		actions: [],
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
  const runtimeIdentity = runtimeTurnIdentityFromResult(result);
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
    runtimeTurnId: runtimeIdentity.runtimeTurnId,
    runtimeStreamId: runtimeIdentity.runtimeStreamId,
    eventTypes: result.events.map((event) => event.type),
    messageCount: result.messages.length,
    messages: result.messages,
	actions: [],
    latestAssistantText: latestAssistant?.text || result.outputText,
    reasoningText: result.reasoningText,
    outputText: result.outputText,
    diagnostics: result.diagnostics,
  };
}

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r003
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
  const activeRuntimeTurnId = incoming.runtimeTurnId ?? current.runtimeTurnId;
  const hasLiveTurn = current.state === 'streaming' || incoming.state === 'streaming';
  const currentMessages = hasLiveTurn
    && (!current.runtimeTurnId || current.runtimeTurnId === activeRuntimeTurnId)
    ? correlateCallerLocalTurnMessages(current.messages, current.requestId, activeRuntimeTurnId)
    : current.messages;
  const incomingMessages = hasLiveTurn
    && (!incoming.runtimeTurnId || incoming.runtimeTurnId === activeRuntimeTurnId)
    ? correlateCallerLocalTurnMessages(incoming.messages, incoming.requestId, activeRuntimeTurnId)
    : incoming.messages;
  const messages = mergeConversationMessages(currentMessages, incomingMessages);
	const actionsById = new Map(
		current.actions.map((action) => [zhiyuConversationActionKey(action), action]),
	);
	for (const action of incoming.actions) {
		actionsById.set(zhiyuConversationActionKey(action), action);
	}
	const actions = [...actionsById.values()];
  const latestAssistant = latestAssistantMessage(messages);
  return {
    ...incoming,
    runtimeTurnId: incoming.runtimeTurnId ?? current.runtimeTurnId,
    runtimeStreamId: incoming.runtimeStreamId ?? current.runtimeStreamId,
    messageCount: messages.length,
    messages,
	actions,
    latestAssistantText: latestAssistant?.text || incoming.latestAssistantText,
  };
}

function correlateCallerLocalTurnMessages(
  messages: RuntimeAgentConversationProjectionState['messages'],
  callerRequestId: string | null,
  runtimeTurnId: string | null,
): RuntimeAgentConversationProjectionState['messages'] {
  if (!callerRequestId || !runtimeTurnId) return messages;
  return messages.map((message) => {
    if (conversationMessageTurnId(message) !== callerRequestId
      || conversationMessageRuntimeTurnId(message)) {
      return message;
    }
    return {
      ...message,
      metadata: {
        ...(message.metadata || {}),
        runtimeTurnId,
      },
    };
  });
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
    runtimeTurnId: chat.runtimeTurnId,
    runtimeStreamId: chat.runtimeStreamId,
    messageId: latestAssistant ? originalConversationMessageId(latestAssistant) : null,
  };
}

export function cancelStreamingChatMessages(
  messages: RuntimeAgentConversationProjectionState['messages'],
  canceledAt: string,
): RuntimeAgentConversationProjectionState['messages'] {
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
  const agentHandle = input.conversation.agentHandle;
  const threadId = input.conversation.threadId;
  if (!conversationAnchorId || !agentHandle || !threadId) {
    throw new Error('Zhiyu submitted user message requires Runtime conversation identity.');
  }
  return {
    id: `${input.requestId}:user`,
    sessionId: conversationAnchorId,
    targetId: agentHandle,
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
      threadId,
      turnId: input.requestId,
      sessionId: conversationAnchorId,
      targetId: agentHandle,
      conversationAnchorId,
    },
  };
}

function mergeConversationMessages(
  currentMessages: RuntimeAgentConversationProjectionState['messages'],
  incomingMessages: RuntimeAgentConversationProjectionState['messages'],
): RuntimeAgentConversationProjectionState['messages'] {
  const merged: Array<RuntimeAgentConversationProjectionState['messages'][number]> = [];
  const indexByMessageKey = new Map<string, number>();
  const indexByOriginalMessageId = new Map<string, number>();
  const indexByRuntimeTurnRole = new Map<string, number>();
  const usedIds = new Set<string>();
  const indexMessage = (
    message: RuntimeAgentConversationProjectionState['messages'][number],
    index: number,
  ) => {
    indexByMessageKey.set(mergedConversationMessageKey(message), index);
    indexByOriginalMessageId.set(originalConversationMessageId(message), index);
    const runtimeTurnRole = runtimeTurnRoleKey(message);
    if (runtimeTurnRole) indexByRuntimeTurnRole.set(runtimeTurnRole, index);
  };
  const append = (message: RuntimeAgentConversationProjectionState['messages'][number]) => {
    const normalized = normalizeMergedConversationMessage(message, usedIds);
    const index = merged.length;
    indexMessage(normalized, index);
    usedIds.add(normalized.id);
    merged.push(normalized);
  };
  for (const message of currentMessages) {
    append(message);
  }
  for (const message of incomingMessages) {
    const runtimeTurnRole = runtimeTurnRoleKey(message);
    const existingIndex = indexByMessageKey.get(mergedConversationMessageKey(message))
      ?? indexByOriginalMessageId.get(originalConversationMessageId(message))
      ?? (runtimeTurnRole ? indexByRuntimeTurnRole.get(runtimeTurnRole) : undefined);
    if (existingIndex === undefined) {
      append(message);
    } else {
      const existing = merged[existingIndex];
      const updated = preserveMergedConversationMessageId(existing, message);
      merged[existingIndex] = updated;
      indexMessage(updated, existingIndex);
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
  if (!turnId) {
    return originalMessageId;
  }
  if (isPrimaryConversationTextMessage(message)) {
    if (message.role === 'user') {
      return `${turnId}:primary-user`;
    }
    if (message.role === 'agent' || message.role === 'assistant') {
      return `${turnId}:primary-assistant`;
    }
  }
  return `${turnId}:${originalMessageId}`;
}

function isPrimaryConversationTextMessage(
  message: RuntimeAgentConversationProjectionState['messages'][number],
): boolean {
  return message.kind === undefined || message.kind === 'text' || message.kind === 'streaming';
}

function runtimeTurnRoleKey(
  message: RuntimeAgentConversationProjectionState['messages'][number],
): string | null {
  const runtimeTurnId = conversationMessageRuntimeTurnId(message);
  if (!runtimeTurnId || !isPrimaryConversationTextMessage(message)) return null;
  if (message.role === 'user') return `${runtimeTurnId}:primary-user`;
  if (message.role === 'agent' || message.role === 'assistant') {
    return `${runtimeTurnId}:primary-assistant`;
  }
  return null;
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

function conversationMessageRuntimeTurnId(
  message: RuntimeAgentConversationProjectionState['messages'][number],
): string | null {
  const metadata = message.metadata;
  if (!metadata) return null;
  for (const value of [metadata.runtimeTurnId, metadata.runtime_turn_id]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function runtimeTurnIdentityFromProjection(
  projection: RuntimeAgentConversationProjectionState,
): {
  readonly runtimeTurnId: string | null;
  readonly runtimeStreamId: string | null;
} {
  return runtimeTurnIdentityFromSources([
    projection.diagnostics,
    projection.events,
    projection.messages.map((message) => message.metadata),
  ]);
}

function runtimeTurnIdentityFromResult(
  result: Awaited<ReturnType<typeof runZhiyuAgentChatTurn>>,
): {
  readonly runtimeTurnId: string | null;
  readonly runtimeStreamId: string | null;
} {
  return runtimeTurnIdentityFromSources([
    result.diagnostics,
    result.events,
    result.messages.map((message) => message.metadata),
  ]);
}

function runtimeTurnIdentityFromSources(sources: readonly unknown[]): {
  readonly runtimeTurnId: string | null;
  readonly runtimeStreamId: string | null;
} {
  let runtimeTurnId: string | null = null;
  let runtimeStreamId: string | null = null;
  const visit = (value: unknown) => {
    if (runtimeTurnId && runtimeStreamId) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
        if (runtimeTurnId && runtimeStreamId) {
          return;
        }
      }
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    runtimeTurnId ||= runtimeTurnIdFromRecord(value);
    runtimeStreamId ||= runtimeStreamIdFromRecord(value);
    visit(value.diagnostics);
    visit(value.metadata);
  };
  for (const source of sources) {
    visit(source);
  }
  return { runtimeTurnId, runtimeStreamId };
}

function runtimeTurnIdFromRecord(record: Readonly<Record<string, unknown>>): string | null {
  return firstMatchingText(/^agent_turn_/u, [
    record.runtimeTurnId,
    record.runtime_turn_id,
    record.turnId,
    record.turn_id,
  ]);
}

function runtimeStreamIdFromRecord(record: Readonly<Record<string, unknown>>): string | null {
  return firstMatchingText(/^agent_stream_/u, [
    record.runtimeStreamId,
    record.runtime_stream_id,
    record.streamId,
    record.stream_id,
  ]);
}

function firstMatchingText(
  pattern: RegExp,
  values: readonly unknown[],
): string | null {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const text = value.trim();
    if (pattern.test(text)) {
      return text;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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
