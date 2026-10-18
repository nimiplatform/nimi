import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';

export type AgentManualVoiceRenderRequest = {
  agentHandle: string;
  conversationAnchorId: string;
  messageId: string;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-061
export function resolveLocalAppConversationVoiceRequest(input: {
  message: ConversationCanonicalMessage;
  agentHandle: string | null | undefined;
  activeConversationAnchorId: string | null;
}): AgentManualVoiceRenderRequest | null {
  const message = input.message;
  if ((message.kind || 'text') !== 'text' || (message.role !== 'assistant' && message.role !== 'agent') || message.status !== 'complete') {
    return null;
  }
  if (!input.agentHandle) {
    return null;
  }
  const activeConversationAnchorId = normalizeText(input.activeConversationAnchorId);
  if (!activeConversationAnchorId) {
    return null;
  }
  const metadata = message.metadata as Record<string, unknown> | undefined;
  if (metadata?.canonicalPartial === true || (metadata?.canonicalTurnStatus === 'active' && metadata?.canonicalVoiceState !== 'ready') || !normalizeText(metadata?.canonicalTurnId)) {
    return null;
  }
  const conversationAnchorId = normalizeText(metadata?.canonicalConversationAnchorId);
  const messageId = normalizeText(message.id);
  if (!conversationAnchorId || conversationAnchorId !== activeConversationAnchorId || !messageId) {
    return null;
  }
  const text = typeof message.text === 'string' ? message.text : '';
  if (!normalizeText(text)) {
    return null;
  }
  const agentHandle = normalizeText(input.agentHandle);
  if (!agentHandle) {
    return null;
  }
  return {
    agentHandle,
    conversationAnchorId,
    messageId,
  };
}
