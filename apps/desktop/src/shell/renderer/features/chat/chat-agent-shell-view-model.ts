import type {
  ConversationCanonicalMessage,
  ConversationMessageViewModel,
  ConversationTargetSummary,
} from '@nimiplatform/kit/features/chat/headless';
import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadSummary,
} from '../../bridge/runtime-bridge/types';
import type { AgentRuntimeConversationSummary } from './chat-agent-runtime-conversation-summaries';
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
  runtimeConversationSummaries?: readonly AgentRuntimeConversationSummary[];
}): ConversationTargetSummary[] {
  const runtimeSummaryByLocalAgentRef = new Map(
    (input.runtimeConversationSummaries || []).map((summary) => [summary.localAgentRef, summary]),
  );
  return input.targets.map((target) => {
    const existingThread = input.threads.find((thread) => thread.localAgentRef === target.localAgentRef) || null;
    const runtimeSummary = runtimeSummaryByLocalAgentRef.get(target.localAgentRef) || null;
    const persistedTarget = existingThread?.targetSnapshot || null;
    const resolvedTarget = {
      ...target,
      avatarUrl: persistedTarget?.avatarUrl || target.avatarUrl || null,
      presentationProfile: persistedTarget?.presentationProfile || target.presentationProfile || null,
    };
    return {
      id: target.localAgentRef,
      source: 'agent' as const,
      canonicalSessionId: runtimeSummary?.conversationAnchorId || target.localAgentRef,
      title: target.displayName,
      handle: target.handle ? `@${target.handle}` : null,
      bio: target.bio || null,
      avatarUrl: resolvedTarget.avatarUrl || null,
      avatarFallback: target.displayName.charAt(0).toUpperCase() || 'A',
      previewText: runtimeSummary?.lastMessageText || null,
      updatedAt: runtimeSummary ? toIsoStringFromMs(runtimeSummary.updatedAtMs) : null,
      unreadCount: 0,
      status: 'active' as const,
      isOnline: null,
      metadata: {
        ownerUserId: target.ownerUserId,
        runtimeSourceRef: target.runtimeSourceRef,
        localAgentRef: target.localAgentRef,
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
  selectionLocalAgentRef: string | null;
  activeTargetId: string | null;
}): string | null {
  return input.selectionLocalAgentRef || input.activeTargetId || null;
}
