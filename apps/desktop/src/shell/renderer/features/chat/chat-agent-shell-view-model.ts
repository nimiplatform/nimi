import type {
  ConversationCanonicalMessage,
  ConversationMessageViewModel,
  ConversationTargetSummary,
} from '@nimiplatform/kit/features/chat/headless';
import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadSummary,
} from '../../bridge/runtime-bridge/types';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';

export type AgentCharacterProfilePreviewTarget = {
  kind: 'character';
  sourceRef: CharacterSourceRefV3;
  handle: string | null;
  worldName: string | null;
};

function toIsoStringFromMs(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value).toISOString();
}

export function resolveAgentTargetSummaries(input: {
  targets: readonly AgentLocalTargetSnapshot[];
  threads: readonly AgentLocalThreadSummary[];
}): ConversationTargetSummary[] {
  return input.targets.map((target) => {
    const agentHandle = String(target.agentHandle || '').trim();
    const conversationAnchorId = String(target.conversationAnchorId || '').trim();
    if (!agentHandle || !conversationAnchorId) {
      throw new Error('Agent target summary requires canonical handle and Conversation anchor.');
    }
    const existingThread = input.threads.find((thread) => (
      thread.targetSnapshot.agentHandle === agentHandle
      && thread.targetSnapshot.conversationAnchorId === conversationAnchorId
    )) || null;
    const persistedTarget = existingThread?.targetSnapshot || null;
    const resolvedTarget = {
      ...target,
      avatarUrl: persistedTarget?.avatarUrl || target.avatarUrl || null,
      presentationProfile: persistedTarget?.presentationProfile || target.presentationProfile || null,
    };
    return {
      id: agentHandle,
      source: 'agent' as const,
      canonicalSessionId: conversationAnchorId,
      title: target.displayName,
      handle: target.handle ? `@${target.handle}` : null,
      bio: target.bio || null,
      avatarUrl: resolvedTarget.avatarUrl || null,
      avatarFallback: target.displayName.charAt(0).toUpperCase() || 'A',
      previewText: null,
      updatedAt: existingThread ? toIsoStringFromMs(existingThread.updatedAtMs) : null,
      unreadCount: 0,
      status: 'active' as const,
      isOnline: null,
      metadata: {
        agentHandle,
        conversationAnchorId,
        sourceRef: target.sourceRef ?? null,
        worldName: target.worldName,
        ownershipType: target.ownershipType,
        presentationProfile: resolvedTarget.presentationProfile,
      },
    };
  });
}

export function resolveAgentCharacterProfilePreviewTarget(
  target: AgentLocalTargetSnapshot | null | undefined,
): AgentCharacterProfilePreviewTarget | null {
  if (!target?.sourceRef) {
    return null;
  }
  return {
    kind: 'character',
    sourceRef: target.sourceRef,
    handle: target.handle || null,
    worldName: target.worldName || null,
  };
}

export function resolveAgentCanonicalMessages(input: {
  messages: readonly ConversationMessageViewModel[];
  activeThreadId: string | null;
  activeConversationAnchorId: string | null;
  activeTargetId: string | null;
  character: {
    name: string;
    avatarUrl: string | null;
    handle: string | null;
  };
}): ConversationCanonicalMessage[] {
  return input.messages.map((message) => {
    const isUser = message.role === 'user' || message.role === 'human';
    const metadata = (message.metadata as Record<string, unknown> | undefined) || {};
    const kind = String(metadata.kind || '').trim();
    const isImage = kind === 'image';
    const isVoice = kind === 'voice';
    const messageConversationAnchorId = typeof metadata.conversationAnchorId === 'string' && metadata.conversationAnchorId.trim().length > 0
      ? metadata.conversationAnchorId
      : null;
    const conversationAnchorId = input.activeConversationAnchorId || messageConversationAnchorId;
    return {
      id: message.id,
      sessionId: conversationAnchorId || input.activeThreadId || input.activeTargetId || 'agent',
      targetId: input.activeTargetId || '',
      source: 'agent' as const,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      status: message.status,
      error: message.error,
      kind: isImage
        ? (message.status === 'pending' ? 'image-pending' as const : 'image' as const)
        : isVoice
          ? 'voice' as const
          : 'text' as const,
      senderName: isUser ? 'You' : input.character.name,
      senderAvatarUrl: isUser ? undefined : input.character.avatarUrl || undefined,
      senderHandle: isUser ? undefined : input.character.handle || undefined,
      senderKind: isUser ? ('human' as const) : ('agent' as const),
      metadata,
    };
  });
}

export function resolveAgentSelectedTargetId(input: {
  selectionAgentHandle: string | null;
  activeTargetId: string | null;
}): string | null {
  return input.selectionAgentHandle || input.activeTargetId || null;
}
