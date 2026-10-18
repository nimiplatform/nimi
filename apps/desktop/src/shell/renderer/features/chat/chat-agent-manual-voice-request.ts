import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';

export type AgentManualVoiceRenderRequest = {
  agentHandle: string;
  conversationAnchorId: string;
  messageId: string;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// @nimi-authority: rule.nimi.desktop.agent-projection.r029
export function resolveAgentManualVoiceRenderRequest(input: {
  message: ConversationCanonicalMessage;
  activeTarget: AgentLocalTargetSnapshot | null;
  activeConversationAnchorId: string | null;
}): AgentManualVoiceRenderRequest | null {
  const message = input.message;
  if ((message.kind || 'text') !== 'text' || (message.role !== 'assistant' && message.role !== 'agent') || message.status !== 'complete') {
    return null;
  }
  const target = input.activeTarget;
  if (!target) {
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
  const agentHandle = normalizeText(target.agentHandle);
  if (!agentHandle) {
    return null;
  }
  return {
    agentHandle,
    conversationAnchorId,
    messageId,
  };
}
