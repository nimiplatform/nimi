import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import { parseAgentTextTurnDebugMetadata } from './chat-agent-debug-metadata';

export type AgentManualVoiceRenderRequest = {
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  conversationAnchorId: string;
  turnId: string;
  messageId: string;
  text?: string;
  playbackTarget: 'desktop_manual';
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveAgentManualVoiceRenderRequest(input: {
  message: ConversationCanonicalMessage;
  activeTarget: AgentLocalTargetSnapshot | null;
  activeConversationAnchorId: string | null;
}): AgentManualVoiceRenderRequest | null {
  const message = input.message;
  if ((message.kind || 'text') !== 'text' || (message.role !== 'assistant' && message.role !== 'agent')) {
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
  const debugMetadata = parseAgentTextTurnDebugMetadata(message.metadata);
  const runtimeTurns = debugMetadata?.runtimeAgentTurns;
  if (!runtimeTurns || runtimeTurns.transport !== 'runtime.agent.turns') {
    return null;
  }
  const conversationAnchorId = normalizeText(runtimeTurns.conversationAnchorId);
  const turnId = normalizeText(runtimeTurns.runtimeTurnId);
  const messageId = normalizeText(message.id);
  if (!conversationAnchorId || conversationAnchorId !== activeConversationAnchorId || !turnId || !messageId) {
    return null;
  }
  const text = typeof message.text === 'string' ? message.text : '';
  if (!normalizeText(text)) {
    return null;
  }
  const ownerUserId = normalizeText(target.ownerUserId);
  const runtimeSourceRef = normalizeText(target.runtimeSourceRef);
  const localAgentRef = normalizeText(target.localAgentRef);
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef) {
    return null;
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    conversationAnchorId,
    turnId,
    messageId,
    text,
    playbackTarget: 'desktop_manual',
  };
}
