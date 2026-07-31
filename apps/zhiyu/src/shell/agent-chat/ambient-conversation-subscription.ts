import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppClient,
  NimiLocalAppConversationEvent,
} from '@nimiplatform/sdk/app';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat';

import type { ZhiyuEvidence } from '../app/evidence.js';

export type ZhiyuAmbientConversationIdentity = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
};

export type ZhiyuAmbientConversationReduction = {
  readonly chat: ZhiyuEvidence['chat'];
  readonly close: boolean;
};

type AmbientTurn = {
  requestId: string;
  streamId: string | null;
  message: ConversationCanonicalMessage | null;
};

export function createZhiyuAmbientConversationEventReducer(
  identity: ZhiyuAmbientConversationIdentity,
  now: () => number = Date.now,
) {
  const turns = new Map<string, AmbientTurn>();
  const observedEvents = new Set<string>();

  const failure = (
    reasonCode: string,
    message: string,
    source = 'runtime',
  ): ZhiyuAmbientConversationReduction => ({
    chat: chatUpdate({
      identity,
      ready: false,
      state: 'failed',
      reasonCode,
      actionHint: reasonCode === 'zhiyu-conversation-anchor-mismatch'
        ? 'refresh_runtime_conversation_anchor'
        : 'inspect_local_app_conversation_subscription',
      source,
      message,
      requestId: null,
      runtimeTurnId: null,
      runtimeStreamId: null,
      eventType: 'ambient-subscription-failed',
      messages: [],
    }),
    close: true,
  });

  return Object.freeze({
    reduce(event: NimiLocalAppConversationEvent): ZhiyuAmbientConversationReduction | null {
      if (!AMBIENT_MESSAGE_TYPES.has(event.messageType)) return null;
      const payload = recordValue(event.payload);
      const eventAnchorId = textValue(payload, 'conversation_anchor_id', 'conversationAnchorId');
      if (!eventAnchorId || eventAnchorId !== identity.conversationAnchorId) {
        return failure(
          'zhiyu-conversation-anchor-mismatch',
          'Runtime Agent conversation event did not match the open conversation anchor.',
        );
      }
      const runtimeTurnId = textValue(payload, 'turn_id', 'turnId');
      if (!runtimeTurnId) {
        return failure(
          'zhiyu-conversation-turn-id-missing',
          'Runtime Agent conversation event did not carry a turn id.',
        );
      }
      const detail = recordValue(payload.detail);
      const streamId = textValue(payload, 'stream_id', 'streamId') || null;
      const turn = turns.get(runtimeTurnId) ?? {
        requestId: runtimeTurnId,
        streamId,
        message: null,
      };
      if (streamId) turn.streamId = streamId;

      if (event.messageType === 'runtime.agent.turn.accepted') {
        turn.requestId = textValue(detail, 'request_id', 'requestId') || runtimeTurnId;
        turns.set(runtimeTurnId, turn);
        return null;
      }

      if (event.messageType === 'runtime.agent.turn.message_committed') {
        const messageId = textValue(detail, 'message_id', 'messageId')
          || textValue(payload, 'message_id', 'messageId');
        const messageText = textValue(detail, 'text');
        if (!messageId || !messageText) {
          return failure(
            'zhiyu-conversation-committed-message-invalid',
            'Runtime Agent committed-message event was incomplete.',
          );
        }
        const eventKey = `${runtimeTurnId}\u0000${messageId}`;
        if (observedEvents.has(eventKey)) return null;
        observedEvents.add(eventKey);
        turn.message = ambientAssistantMessage({
          identity,
          requestId: turn.requestId,
          runtimeTurnId,
          runtimeStreamId: turn.streamId,
          messageId,
          text: messageText,
          createdAt: eventTimestamp(event, now),
        });
        turns.set(runtimeTurnId, turn);
        return {
          chat: chatUpdate({
            identity,
            ready: false,
            state: 'streaming',
            reasonCode: 'runtime-agent-turn-message-committed',
            actionHint: 'wait_runtime_agent_turn_terminal',
            source: 'runtime',
            message: 'Runtime Agent committed a conversation message.',
            requestId: turn.requestId,
            runtimeTurnId,
            runtimeStreamId: turn.streamId,
            eventType: event.messageType,
            messages: [turn.message],
          }),
          close: false,
        };
      }

      const terminalKey = `${event.messageType}\u0000${runtimeTurnId}`;
      if (observedEvents.has(terminalKey)) return null;
      observedEvents.add(terminalKey);
      turns.set(runtimeTurnId, turn);
      const terminal = terminalProjection(event, detail);
      return {
        chat: chatUpdate({
          identity,
          ...terminal,
          requestId: turn.requestId,
          runtimeTurnId,
          runtimeStreamId: turn.streamId,
          eventType: event.messageType,
          messages: turn.message ? [turn.message] : [],
        }),
        close: false,
      };
    },
    failure(error: unknown): ZhiyuAmbientConversationReduction {
      const record = recordValue(error);
      return failure(
        textValue(record, 'reasonCode') || 'zhiyu-conversation-ambient-subscription-failed',
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Runtime Agent ambient conversation subscription failed.',
        textValue(record, 'source') || 'sdk',
      );
    },
  });
}

export function subscribeZhiyuAmbientConversation(input: {
  readonly conversation: Pick<NimiLocalAppClient['conversation'], 'subscribe'>;
  readonly identity: ZhiyuAmbientConversationIdentity;
  readonly onChat: (chat: ZhiyuEvidence['chat']) => void;
  readonly now?: () => number;
}): () => void {
  let active = true;
  let subscription: Awaited<ReturnType<typeof input.conversation.subscribe>> | null = null;
  let cancellation: Promise<void> | null = null;
  const reducer = createZhiyuAmbientConversationEventReducer(input.identity, input.now);
  const cancel = (): Promise<void> => {
    if (!subscription) return Promise.resolve();
    cancellation ??= subscription.cancel().catch(() => undefined);
    return cancellation;
  };

  void (async () => {
    try {
      subscription = await input.conversation.subscribe(input.identity);
      if (!active) return;
      for await (const event of subscription) {
        if (!active) break;
        const reduction = reducer.reduce(event);
        if (!reduction) continue;
        input.onChat(reduction.chat);
        if (reduction.close) break;
      }
    } catch (error) {
      if (active) input.onChat(reducer.failure(error).chat);
    } finally {
      await cancel();
    }
  })();

  return () => {
    if (!active) return;
    active = false;
    void cancel();
  };
}

const AMBIENT_MESSAGE_TYPES = new Set([
  'runtime.agent.turn.accepted',
  'runtime.agent.turn.message_committed',
  'runtime.agent.turn.completed',
  'runtime.agent.turn.failed',
  'runtime.agent.turn.interrupted',
]);

function ambientAssistantMessage(input: {
  readonly identity: ZhiyuAmbientConversationIdentity;
  readonly requestId: string;
  readonly runtimeTurnId: string;
  readonly runtimeStreamId: string | null;
  readonly messageId: string;
  readonly text: string;
  readonly createdAt: string;
}): ConversationCanonicalMessage {
  return {
    id: input.messageId,
    sessionId: input.identity.conversationAnchorId,
    targetId: input.identity.agentHandle,
    source: 'agent',
    role: 'agent',
    text: input.text,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    status: 'complete',
    kind: 'text',
    senderName: 'Zhiyu Agent',
    senderKind: 'agent',
    metadata: {
      modeId: 'runtime-agent-chat-v1',
      turnId: input.requestId,
      runtimeTurnId: input.runtimeTurnId,
      ...(input.runtimeStreamId ? { runtimeStreamId: input.runtimeStreamId } : {}),
      conversationAnchorId: input.identity.conversationAnchorId,
    },
  };
}

function chatUpdate(input: {
  readonly identity: ZhiyuAmbientConversationIdentity;
  readonly ready: boolean;
  readonly state: ZhiyuEvidence['chat']['state'];
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly requestId: string | null;
  readonly runtimeTurnId: string | null;
  readonly runtimeStreamId: string | null;
  readonly eventType: string;
  readonly messages: ZhiyuEvidence['chat']['messages'];
}): ZhiyuEvidence['chat'] {
  const latestAssistant = input.messages.at(-1) ?? null;
  return {
    transport: 'electron-ipc',
    ready: input.ready,
    state: input.state,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    conversationAnchorId: input.identity.conversationAnchorId,
    requestId: input.requestId,
    runtimeTurnId: input.runtimeTurnId,
    runtimeStreamId: input.runtimeStreamId,
    eventTypes: [input.eventType],
    messageCount: input.messages.length,
    messages: input.messages,
    latestAssistantText: latestAssistant?.text || null,
    reasoningText: null,
    outputText: latestAssistant?.text || null,
    diagnostics: {
      ambientConversationSubscription: true,
    },
  };
}

function terminalProjection(
  event: NimiLocalAppConversationEvent,
  detail: Readonly<Record<string, unknown>>,
): Pick<
  Parameters<typeof chatUpdate>[0],
  'ready' | 'state' | 'reasonCode' | 'actionHint' | 'source' | 'message'
> {
  if (event.messageType === 'runtime.agent.turn.completed') {
    return {
      ready: true,
      state: 'completed',
      reasonCode: 'runtime-agent-turn-completed',
      actionHint: 'review_runtime_agent_chat_message',
      source: 'runtime',
      message: 'Runtime Agent turn completed.',
    };
  }
  if (event.messageType === 'runtime.agent.turn.interrupted') {
    return {
      ready: false,
      state: 'canceled',
      reasonCode: event.reasonCode || 'runtime-agent-turn-interrupted',
      actionHint: 'send_runtime_agent_turn',
      source: 'runtime',
      message: 'Runtime Agent turn was interrupted.',
    };
  }
  return {
    ready: false,
    state: 'failed',
    reasonCode: event.reasonCode || 'runtime-agent-turn-failed',
    actionHint: 'inspect_runtime_agent_chat_stream',
    source: 'runtime',
    message: textValue(detail, 'message') || 'Runtime Agent turn failed.',
  };
}

function eventTimestamp(event: NimiLocalAppConversationEvent, now: () => number): string {
  const timestamp = event.timestampUnixMs ?? now();
  return new Date(timestamp).toISOString();
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function textValue(record: Readonly<Record<string, unknown>>, ...keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}
