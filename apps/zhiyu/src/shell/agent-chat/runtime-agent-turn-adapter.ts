import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  createRuntimeAgentConversationProjectionState,
  reduceRuntimeAgentConversationProjectionEvent,
  streamRuntimeAgentTurnRunnerPartsAsConversationEvents,
  type ConversationTurnEvent,
  type RuntimeAgentConversationProjectionState,
  type RuntimeAgentTurnRunnerPartLike,
} from '@nimiplatform/kit/features/chat/headless';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppClient,
  NimiLocalAppConversationEvent,
} from '@nimiplatform/sdk/app';
import type { ZhiyuConversationHomeStatus } from '../agent/conversation-home';
import { getZhiyuLocalAppClient } from '../auth/runtime-platform';

export type ZhiyuRuntimeAgentChatState =
  | 'idle'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'canceled';

export type ZhiyuRuntimeAgentChatTurnResult = {
  readonly transport: 'electron-ipc';
  readonly ready: boolean;
  readonly state: ZhiyuRuntimeAgentChatState;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly agentHandle: string | null;
  readonly ownerUserId: string | null;
  readonly runtimeSourceRef: string | null;
  readonly localAgentRef: string | null;
  readonly conversationAnchorId: string | null;
  readonly requestId: string | null;
  readonly events: readonly ConversationTurnEvent[];
  readonly messages: RuntimeAgentConversationProjectionState['messages'];
  readonly reasoningText: string | null;
  readonly outputText: string | null;
  readonly diagnostics: RuntimeAgentConversationProjectionState['diagnostics'];
};

export type ZhiyuRuntimeAgentChatStreamTurn = (
  request: ZhiyuLocalAppTurnRequest,
  options?: {
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly stream: AsyncIterable<RuntimeAgentTurnRunnerPartLike | unknown>;
}>;

export type ZhiyuLocalAppTurnRequest = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
  readonly threadId: string;
  readonly requestId: string;
  readonly text: string;
};

export type ZhiyuRuntimeAgentChatTurnInput = {
  readonly conversation: ZhiyuConversationHomeStatus;
  readonly text: unknown;
  readonly requestId?: unknown;
  readonly expectedConversationAnchorId?: unknown;
  readonly signal?: AbortSignal;
  readonly streamTurn?: ZhiyuRuntimeAgentChatStreamTurn;
  readonly conversationClient?: NimiLocalAppClient['conversation'];
  readonly onEvent?: (
    event: ConversationTurnEvent,
    state: RuntimeAgentConversationProjectionState,
  ) => void;
};

export async function runZhiyuAgentChatTurn(
  input: ZhiyuRuntimeAgentChatTurnInput,
): Promise<ZhiyuRuntimeAgentChatTurnResult> {
  if ('attachments' in input) {
    return chatUnavailable({
      reasonCode: 'zhiyu-turn-attachment-unsupported',
      actionHint: 'remove_conversation_attachment',
      source: 'renderer',
      message: 'Third-party Local App Agent conversations are text-only.',
      requestId: stringOr(input.requestId, null),
    });
  }
  const identity = conversationIdentity(input.conversation);
  if (!identity) {
    return chatUnavailable({
      reasonCode: 'zhiyu-conversation-anchor-required',
      actionHint: 'open_runtime_conversation_anchor',
      source: input.conversation.source,
      message: 'Zhiyu requires a Runtime-owned conversation anchor before sending a chat turn.',
      agentHandle: input.conversation.agentHandle,
      ownerUserId: input.conversation.ownerUserId,
      runtimeSourceRef: input.conversation.runtimeSourceRef,
      localAgentRef: input.conversation.localAgentRef,
      conversationAnchorId: input.conversation.conversationAnchorId,
      requestId: stringOr(input.requestId, null),
    });
  }

  const expectedConversationAnchorId = stringOr(input.expectedConversationAnchorId, null);
  if (expectedConversationAnchorId && expectedConversationAnchorId !== identity.conversationAnchorId) {
    return chatUnavailable({
      reasonCode: 'zhiyu-conversation-anchor-mismatch',
      actionHint: 'refresh_runtime_conversation_anchor',
      source: 'renderer',
      message: 'Runtime Agent chat turn was blocked because the active conversation anchor changed.',
      ...identity,
      requestId: stringOr(input.requestId, null),
    });
  }

  const text = stringOr(input.text, '');
  if (!text) {
    return chatUnavailable({
      reasonCode: 'zhiyu-turn-text-required',
      actionHint: 'enter_runtime_agent_turn_text',
      source: 'renderer',
      message: 'Runtime Agent chat turn text is required.',
      ...identity,
      requestId: stringOr(input.requestId, null),
    });
  }

  const requestId = stringOr(input.requestId, createTurnRequestId());
  const request = buildLocalAppTurnRequest({
    ...identity,
    requestId,
    text,
  });
  const streamTurn = input.streamTurn
    ?? createLocalAppStreamTurn(input.conversationClient ?? getZhiyuLocalAppClient().conversation);
  const initialProjection = createRuntimeAgentConversationProjectionState({
    modeId: 'runtime-agent-chat-v1',
    threadId: identity.threadId,
    turnId: requestId,
    sessionId: identity.conversationAnchorId,
    targetId: identity.agentHandle,
    conversationAnchorId: identity.conversationAnchorId,
    localAgentRef: null,
    userMessage: {
      id: `${requestId}:user`,
      text,
    },
    assistantMessageId: `${requestId}:assistant`,
    assistantName: 'Zhiyu Agent',
  });

  try {
    const streamed = await streamTurn(request, { signal: input.signal });
    let projection = initialProjection;
    for await (const event of streamRuntimeAgentTurnRunnerPartsAsConversationEvents({
      modeId: 'runtime-agent-chat-v1',
      threadId: identity.threadId,
      turnId: requestId,
      parts: streamed.stream,
    })) {
      projection = reduceRuntimeAgentConversationProjectionEvent(projection, event);
      input.onEvent?.(event, projection);
    }
    return chatResultFromProjection(projection, {
      ...identity,
      requestId,
    });
  } catch (error) {
    return chatUnavailable({
      reasonCode: errorReasonCode(error),
      actionHint: 'inspect_runtime_agent_chat_stream',
      source: errorSource(error),
      message: errorMessage(error),
      ...identity,
      requestId,
      events: initialProjection.events,
      messages: initialProjection.messages,
    });
  }
}

// Turn requests carry identity and content only; Runtime owns execution selection.
function buildLocalAppTurnRequest(input: {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
  readonly threadId: string;
  readonly requestId: string;
  readonly text: string;
}): ZhiyuLocalAppTurnRequest {
  return {
    agentHandle: input.agentHandle,
    conversationAnchorId: input.conversationAnchorId,
    requestId: input.requestId,
    threadId: input.threadId,
    text: input.text,
  };
}

function createLocalAppStreamTurn(
  conversation: NimiLocalAppClient['conversation'],
): ZhiyuRuntimeAgentChatStreamTurn {
  return async (request, options) => {
    if (typeof window === 'undefined' || !hasElectronRuntime()) {
      throw Object.assign(new Error('Electron Runtime bridge is not available.'), {
        reasonCode: 'electron-runtime-bridge-unavailable',
        actionHint: 'restart_zhiyu_electron_shell',
        source: 'renderer',
      });
    }
    return {
      stream: localAppConversationParts(conversation, request, options?.signal),
    };
  };
}

async function* localAppConversationParts(
  conversation: NimiLocalAppClient['conversation'],
  request: ZhiyuLocalAppTurnRequest,
  signal?: AbortSignal,
): AsyncIterable<RuntimeAgentTurnRunnerPartLike> {
  const scope = {
    agentHandle: request.agentHandle,
    conversationAnchorId: request.conversationAnchorId,
  } as const;
  const subscription = await conversation.subscribe(scope);
  try {
    const sent = await conversation.send({
      ...scope,
      requestId: request.requestId,
      text: request.text,
    });
    for await (const event of subscription) {
      if (signal?.aborted) {
        yield { type: 'turn-canceled', scope: 'turn' };
        return;
      }
      if (event.conversationAnchorId !== request.conversationAnchorId
        || event.turnId !== sent.turnId) {
        continue;
      }
      if (event.type === 'turn-accepted' && event.requestId !== request.requestId) {
        continue;
      }
      const part = localAppEventPart(event);
      if (part) {
        yield part;
      }
      if (part?.type === 'turn-completed'
        || part?.type === 'turn-failed'
        || part?.type === 'turn-canceled') {
        return;
      }
    }
  } finally {
    await subscription.cancel();
  }
}

function localAppEventPart(
  event: NimiLocalAppConversationEvent,
): RuntimeAgentTurnRunnerPartLike | null {
  switch (event.type) {
    case 'text-delta':
      return { type: 'text-delta', textDelta: event.text };
    case 'message-committed':
      return {
        type: 'message-sealed',
        envelope: {
          message: {
            messageId: event.messageId,
            text: event.text,
          },
        },
      };
    case 'turn-completed':
      return {
        type: 'turn-completed',
        finishReason: event.terminalReason,
        diagnostics: { runtimeTurnId: event.turnId },
      };
    case 'turn-failed':
      return {
        type: 'turn-failed',
        error: {
          code: event.reasonCode,
          message: event.message || 'Runtime Agent turn failed.',
        },
      };
    case 'turn-interrupted':
      return { type: 'turn-canceled', scope: 'turn' };
    case 'turn-accepted':
    case 'turn-started':
      return null;
  }
}

function conversationIdentity(conversation: ZhiyuConversationHomeStatus): {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
  readonly threadId: string;
} | null {
  if (!conversation.ready) {
    return null;
  }
  const agentHandle = stringOr(conversation.agentHandle, '');
  const conversationAnchorId = stringOr(conversation.conversationAnchorId, '');
  const threadId = stringOr(conversation.threadId, '');
  if (!agentHandle || !conversationAnchorId || !threadId) {
    return null;
  }
  return {
    agentHandle: agentHandle as NimiLocalAppAgentHandle,
    conversationAnchorId,
    threadId,
  };
}

function chatResultFromProjection(
  projection: RuntimeAgentConversationProjectionState,
  identity: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly conversationAnchorId: string;
    readonly requestId: string;
  },
): ZhiyuRuntimeAgentChatTurnResult {
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
    agentHandle: identity.agentHandle,
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    conversationAnchorId: identity.conversationAnchorId,
    requestId: identity.requestId,
    events: projection.events,
    messages: projection.messages,
    reasoningText: projection.reasoningText || null,
    outputText: projection.outputText || null,
    diagnostics: projection.diagnostics,
  };
}

function chatUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly agentHandle?: string | null;
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
  readonly localAgentRef?: string | null;
  readonly conversationAnchorId?: string | null;
  readonly requestId?: string | null;
  readonly events?: readonly ConversationTurnEvent[];
  readonly messages?: RuntimeAgentConversationProjectionState['messages'];
}): ZhiyuRuntimeAgentChatTurnResult {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'failed',
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    agentHandle: input.agentHandle ?? null,
    ownerUserId: input.ownerUserId ?? null,
    runtimeSourceRef: input.runtimeSourceRef ?? null,
    localAgentRef: input.localAgentRef ?? null,
    conversationAnchorId: input.conversationAnchorId ?? null,
    requestId: input.requestId ?? null,
    events: input.events || [],
    messages: input.messages || [],
    reasoningText: null,
    outputText: null,
    diagnostics: null,
  };
}

function errorReasonCode(error: unknown): string {
  const record = errorRecord(error);
  return stringOr(record.reasonCode, 'zhiyu-runtime-agent-chat-stream-failed');
}

function errorSource(error: unknown): string {
  return stringOr(errorRecord(error).source, 'sdk');
}

function errorActionHint(error: unknown): string {
  return stringOr(errorRecord(error).actionHint, 'inspect_runtime_agent_chat_stream');
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'Runtime Agent chat stream failed.';
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === 'object' ? error as Record<string, unknown> : {};
}

function createTurnRequestId(): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `zhiyu-turn-${randomId}`;
}

function stringOr(value: unknown, fallback: string): string;
function stringOr(value: unknown, fallback: null): string | null;
function stringOr(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
