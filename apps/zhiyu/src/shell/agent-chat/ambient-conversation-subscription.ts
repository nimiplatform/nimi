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
      eventType: 'ambient-subscription-failed',
      messages: [],
    }),
    close: true,
  });

  return Object.freeze({
    reduce(event: NimiLocalAppConversationEvent): ZhiyuAmbientConversationReduction | null {
      if (!AMBIENT_EVENT_TYPES.has(event.type)) return null;
      if (event.conversationAnchorId !== identity.conversationAnchorId) {
        return failure(
          'zhiyu-conversation-anchor-mismatch',
          'Runtime Agent conversation event did not match the open conversation anchor.',
        );
      }
      const runtimeTurnId = event.turnId;
      const turn = turns.get(runtimeTurnId) ?? {
        requestId: runtimeTurnId,
        message: null,
      };

      if (event.type === 'turn-accepted') {
        turn.requestId = event.requestId;
        turns.set(runtimeTurnId, turn);
        return null;
      }

      if (event.type === 'message-committed') {
        const eventKey = `${runtimeTurnId}\u0000${event.messageId}`;
        if (observedEvents.has(eventKey)) return null;
        observedEvents.add(eventKey);
        turn.message = ambientAssistantMessage({
          identity,
          requestId: turn.requestId,
          runtimeTurnId,
          messageId: event.messageId,
          text: event.text,
          createdAt: new Date(now()).toISOString(),
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
            eventType: event.type,
            messages: [turn.message],
          }),
          close: false,
        };
      }

      if (event.type !== 'turn-completed'
        && event.type !== 'turn-failed'
        && event.type !== 'turn-interrupted') {
        return null;
      }
      const terminalKey = `${event.type}\u0000${runtimeTurnId}`;
      if (observedEvents.has(terminalKey)) return null;
      observedEvents.add(terminalKey);
      turns.set(runtimeTurnId, turn);
      const terminal = terminalProjection(event);
      return {
        chat: chatUpdate({
          identity,
          ...terminal,
          requestId: turn.requestId,
          runtimeTurnId,
          eventType: event.type,
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

const AMBIENT_EVENT_TYPES = new Set<NimiLocalAppConversationEvent['type']>([
  'turn-accepted',
  'message-committed',
  'turn-completed',
  'turn-failed',
  'turn-interrupted',
]);

function ambientAssistantMessage(input: {
  readonly identity: ZhiyuAmbientConversationIdentity;
  readonly requestId: string;
  readonly runtimeTurnId: string;
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
    runtimeStreamId: null,
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
  event: Extract<NimiLocalAppConversationEvent, {
    type: 'turn-completed' | 'turn-failed' | 'turn-interrupted';
  }>,
): Pick<
  Parameters<typeof chatUpdate>[0],
  'ready' | 'state' | 'reasonCode' | 'actionHint' | 'source' | 'message'
> {
  if (event.type === 'turn-completed') {
    return {
      ready: true,
      state: 'completed',
      reasonCode: 'runtime-agent-turn-completed',
      actionHint: 'review_runtime_agent_chat_message',
      source: 'runtime',
      message: 'Runtime Agent turn completed.',
    };
  }
  if (event.type === 'turn-interrupted') {
    return {
      ready: false,
      state: 'canceled',
      reasonCode: event.reason,
      actionHint: 'send_runtime_agent_turn',
      source: 'runtime',
      message: 'Runtime Agent turn was interrupted.',
    };
  }
  return {
    ready: false,
    state: 'failed',
    reasonCode: event.reasonCode,
    actionHint: 'inspect_runtime_agent_chat_stream',
    source: 'runtime',
    message: event.message || 'Runtime Agent turn failed.',
  };
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
