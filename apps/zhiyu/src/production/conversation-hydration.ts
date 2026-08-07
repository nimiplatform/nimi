import type {
  NimiLocalAppClient,
  NimiLocalAppConversationSnapshot,
} from '@nimiplatform/sdk/app';

import type { ZhiyuCanonicalRendererBindings } from '../renderer/contract.js';
import { hydrateZhiyuAgentChatFromLocalAppConversationSnapshot } from '../shell/agent-chat/agent-conversation-state.js';
import type { ZhiyuEvidence } from '../shell/app/evidence.js';

type HydrationInput = Parameters<
  ZhiyuCanonicalRendererBindings['app']['projection']['hydrateConversation']
>[0];

type ConversationSnapshotPort = Pick<NimiLocalAppClient['conversation'], 'snapshot'>;

export async function hydrateZhiyuProductionConversation(
  input: HydrationInput,
  conversation: ConversationSnapshotPort,
): Promise<Pick<ZhiyuEvidence, 'source' | 'chat'>> {
  try {
    const snapshot = await conversation.snapshot({
      agentHandle: input.agentHandle as Parameters<ConversationSnapshotPort['snapshot']>[0]['agentHandle'],
      conversationAnchorId: input.conversationAnchorId,
    });
    return {
      source: input.currentSource,
      chat: hydrateZhiyuAgentChatFromLocalAppConversationSnapshot({
        current: input.currentChat,
        agentHandle: input.agentHandle,
        conversationAnchorId: input.conversationAnchorId,
        snapshot: snapshot as NimiLocalAppConversationSnapshot,
      }),
    };
  } catch (error) {
    return {
      source: input.currentSource,
      chat: hydrationFailure(input, error),
    };
  }
}

function hydrationFailure(input: HydrationInput, error: unknown): HydrationInput['currentChat'] {
  const record = isRecord(error) ? error : {};
  return {
    ...input.currentChat,
    ready: false,
    state: 'failed',
    reasonCode: text(record.reasonCode) || 'zhiyu-conversation-snapshot-hydration-failed',
    actionHint: text(record.actionHint) || 'retry_local_app_conversation_snapshot',
    source: text(record.source) || 'sdk',
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Runtime conversation snapshot hydration failed.',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    conversationAnchorId: input.conversationAnchorId,
    messageCount: input.currentChat.messages.length,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
