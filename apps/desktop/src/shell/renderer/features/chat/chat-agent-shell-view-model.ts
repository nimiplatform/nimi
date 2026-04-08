import type {
  ConversationCanonicalMessage,
  ConversationMessageViewModel,
  ConversationTargetSummary,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';

export function resolveAgentTargetSummaries(input: {
  targets: readonly AgentLocalTargetSnapshot[];
  threads: readonly AgentLocalThreadSummary[];
}): ConversationTargetSummary[] {
  return input.targets.map((target) => ({
    id: target.agentId,
    source: 'agent' as const,
    canonicalSessionId: input.threads.find((thread) => thread.agentId === target.agentId)?.id || target.agentId,
    title: target.displayName,
    handle: target.handle ? `@${target.handle}` : null,
    bio: target.bio || null,
    avatarUrl: target.avatarUrl || null,
    avatarFallback: target.displayName.charAt(0).toUpperCase() || 'A',
    previewText: null,
    updatedAt: null,
    unreadCount: 0,
    status: 'active' as const,
    isOnline: null,
    metadata: {
      worldName: target.worldName,
      ownershipType: target.ownershipType,
    },
  }));
}

export function resolveAgentCanonicalMessages(input: {
  messages: readonly ConversationMessageViewModel[];
  activeThreadId: string | null;
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
    return {
      id: message.id,
      sessionId: input.activeThreadId || input.activeTargetId || 'agent',
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
  selectionAgentId: string | null;
  activeTargetId: string | null;
}): string | null {
  return input.selectionAgentId || input.activeTargetId || null;
}
