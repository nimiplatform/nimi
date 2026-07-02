import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  createRuntimeAgentConversationProjectionState,
  reduceRuntimeAgentConversationProjectionEvent,
  streamRuntimeAgentTurnRunnerPartsAsConversationEvents,
  type RuntimeAgentConversationProjectionState,
  type RuntimeAgentTurnRunnerPartLike,
} from '@nimiplatform/kit/features/chat/headless';
import {
  createNimiRuntimeAgentClient,
  Runtime,
  type NimiRuntimeAgentTurnRequest,
} from '@nimiplatform/sdk/runtime';
import type { ConversationTurnEvent } from '@nimiplatform/kit/features/chat/headless';
import type { ZhiyuConversationHomeStatus } from './conversation-home';
import type { ZhiyuRuntimeRouteStatus } from './route-projection';
import { withZhiyuElectronRuntimeProtectedScopes } from './runtime-agent-scopes';

type ZhiyuRuntimeTurnExecutionBinding = NonNullable<ZhiyuRuntimeRouteStatus['executionBinding']>;

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
  request: NimiRuntimeAgentTurnRequest,
  options?: {
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly stream: AsyncIterable<RuntimeAgentTurnRunnerPartLike | unknown>;
}>;

export type ZhiyuRuntimeAgentChatTurnInput = {
  readonly conversation: ZhiyuConversationHomeStatus;
  readonly route: ZhiyuRuntimeRouteStatus;
  readonly text: unknown;
  readonly requestId?: unknown;
  readonly attachments?: readonly unknown[];
  readonly expectedConversationAnchorId?: unknown;
  readonly signal?: AbortSignal;
  readonly streamTurn?: ZhiyuRuntimeAgentChatStreamTurn;
  readonly onEvent?: (
    event: ConversationTurnEvent,
    state: RuntimeAgentConversationProjectionState,
  ) => void;
};

export async function runZhiyuRuntimeAgentChatTurn(
  input: ZhiyuRuntimeAgentChatTurnInput,
): Promise<ZhiyuRuntimeAgentChatTurnResult> {
  const identity = conversationIdentity(input.conversation);
  if (!identity) {
    return chatUnavailable({
      reasonCode: 'zhiyu-conversation-anchor-required',
      actionHint: 'open_runtime_conversation_anchor',
      source: input.conversation.source,
      message: 'Zhiyu requires a Runtime-owned conversation anchor before sending a chat turn.',
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

  const executionBinding = normalizeExecutionBinding(input.route.executionBinding);
  if (!executionBinding) {
    return chatUnavailable({
      reasonCode: 'zhiyu-runtime-route-required',
      actionHint: 'select_runtime_agent_route',
      source: input.route.source,
      message: 'Zhiyu requires an admitted Runtime execution binding before sending a chat turn.',
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

  if (input.attachments && input.attachments.length > 0) {
    return chatUnavailable({
      reasonCode: 'zhiyu-runtime-agent-chat-attachments-not-admitted',
      actionHint: 'remove_runtime_agent_chat_attachments',
      source: 'renderer',
      message: 'Runtime Agent chat attachments are not admitted for Zhiyu yet.',
      ...identity,
      requestId: stringOr(input.requestId, null),
    });
  }

  const requestId = stringOr(input.requestId, createTurnRequestId());
  const request = buildRuntimeAgentTurnRequest({
    ...identity,
    requestId,
    text,
    executionBinding,
  });
  const streamTurn = input.streamTurn ?? createElectronRuntimeAgentStreamTurn(identity.ownerUserId);
  const initialProjection = createRuntimeAgentConversationProjectionState({
    modeId: 'runtime-agent-chat-v1',
    threadId: identity.conversationAnchorId,
    turnId: requestId,
    sessionId: identity.conversationAnchorId,
    targetId: identity.localAgentRef,
    conversationAnchorId: identity.conversationAnchorId,
    localAgentRef: identity.localAgentRef,
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
      threadId: identity.conversationAnchorId,
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

function buildRuntimeAgentTurnRequest(input: {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
  readonly requestId: string;
  readonly text: string;
  readonly executionBinding: ZhiyuRuntimeTurnExecutionBinding;
}): NimiRuntimeAgentTurnRequest {
  const executionBindings: NimiRuntimeAgentTurnRequest['executionBindings'] = {};
  executionBindings['text.generate'] = input.executionBinding;
  return {
    ownerUserId: input.ownerUserId,
    runtimeSourceRef: input.runtimeSourceRef,
    localAgentRef: input.localAgentRef,
    conversationAnchorId: input.conversationAnchorId,
    requestId: input.requestId,
    executionBindings,
    messages: [
      {
        role: 'user',
        content: input.text,
      },
    ],
  };
}

function createElectronRuntimeAgentStreamTurn(ownerUserId: string): ZhiyuRuntimeAgentChatStreamTurn {
  return async (request, options) => {
    if (typeof window === 'undefined' || !hasElectronRuntime()) {
      throw Object.assign(new Error('Electron Runtime bridge is not available.'), {
        reasonCode: 'electron-runtime-bridge-unavailable',
        actionHint: 'restart_zhiyu_electron_shell',
        source: 'renderer',
      });
    }
    const runtime = new Runtime({
      appId: 'nimi.zhiyu',
      transport: { type: 'electron-ipc' },
    });
    const client = createNimiRuntimeAgentClient({
      runtime,
      appId: 'nimi.zhiyu',
      getSubjectUserId: () => ownerUserId,
      withScopes: withZhiyuElectronRuntimeProtectedScopes,
    });
    return client.streamTurn(request, {
      signal: options?.signal,
    });
  };
}

function conversationIdentity(conversation: ZhiyuConversationHomeStatus): {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
} | null {
  if (!conversation.ready) {
    return null;
  }
  const ownerUserId = stringOr(conversation.ownerUserId, '');
  const runtimeSourceRef = stringOr(conversation.runtimeSourceRef, '');
  const localAgentRef = stringOr(conversation.localAgentRef, '');
  const conversationAnchorId = stringOr(conversation.conversationAnchorId, '');
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef || !conversationAnchorId) {
    return null;
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    conversationAnchorId,
  };
}

function normalizeExecutionBinding(
  value: ZhiyuRuntimeTurnExecutionBinding | null | undefined,
): ZhiyuRuntimeTurnExecutionBinding | null {
  if (!value) {
    return null;
  }
  const route = value.route;
  const model = stringOr(value['modelId'], '');
  if ((route !== 'local' && route !== 'cloud') || !model) {
    return null;
  }
  return {
    route,
    ['modelId']: model,
    targetRef: value.targetRef,
    ...(stringOr(value.connectorId, '') ? { connectorId: stringOr(value.connectorId, '') } : {}),
  };
}

function chatResultFromProjection(
  projection: RuntimeAgentConversationProjectionState,
  identity: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
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
    ownerUserId: identity.ownerUserId,
    runtimeSourceRef: identity.runtimeSourceRef,
    localAgentRef: identity.localAgentRef,
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
