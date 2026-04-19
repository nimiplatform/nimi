import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import { dataSync } from '@runtime/data-sync';
import {
  collapseHumanChatsToTargets,
  compareHumanChatsByRecency,
  getHumanChatPreview,
  getHumanChatTitle,
  getHumanTargetId,
  type HumanChatViewDto,
} from './chat-human-thread-model';
import {
  toAgentFriendTargetsFromSocialSnapshot,
} from './chat-agent-thread-model';
import { TARGETS_QUERY_KEY } from './chat-agent-shell-core';
import {
  compareGroupChatsByRecency,
  toGroupTargetSummary,
  type GroupChatViewDto,
} from './chat-group-thread-model';

type SocialSnapshot = Awaited<ReturnType<typeof dataSync.loadSocialSnapshot>>;

export function toHumanTargetSummary(chat: HumanChatViewDto): ConversationTargetSummary {
  return {
    id: getHumanTargetId(chat),
    source: 'human' as const,
    canonicalSessionId: String(chat.id || ''),
    title: getHumanChatTitle(chat),
    handle: String(chat.otherUser?.handle || '').trim()
      ? `@${String(chat.otherUser?.handle || '').trim()}`
      : null,
    bio: null,
    avatarUrl: String(chat.otherUser?.avatarUrl || '').trim() || null,
    avatarFallback: getHumanChatTitle(chat).charAt(0).toUpperCase() || 'H',
    previewText: getHumanChatPreview(chat),
    updatedAt: String(chat.lastMessageAt || chat.lastMessage?.createdAt || chat.createdAt || ''),
    unreadCount: Number(chat.unreadCount || 0),
    status: 'active' as const,
    isOnline: null,
    metadata: {
      otherUserId: getHumanTargetId(chat),
    },
  };
}

export function useChatTargetsForSidebar(
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated',
): readonly ConversationTargetSummary[] {
  const { t } = useTranslation();

  const humanChatsQuery = useQuery({
    queryKey: ['chats', authStatus],
    queryFn: async () => dataSync.loadChats(),
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });

  const groupChatsQuery = useQuery({
    queryKey: ['group-chats', authStatus],
    queryFn: async () => dataSync.loadGroupChats(),
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });

  const agentTargetsQuery = useQuery({
    queryKey: [...TARGETS_QUERY_KEY, authStatus],
    queryFn: async (): Promise<ReturnType<typeof toAgentFriendTargetsFromSocialSnapshot>> => {
      const snapshot = await dataSync.loadSocialSnapshot() as SocialSnapshot;
      return toAgentFriendTargetsFromSocialSnapshot(snapshot);
    },
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });

  const humanTargets = useMemo(() => {
    const allChats = ((humanChatsQuery.data as { items?: HumanChatViewDto[] } | undefined)?.items || []) as HumanChatViewDto[];
    const sorted = [...allChats].sort(compareHumanChatsByRecency);
    const collapsed = collapseHumanChatsToTargets(sorted);
    return collapsed.map(toHumanTargetSummary);
  }, [humanChatsQuery.data]);

  const agentTargets = useMemo(() => {
    const snapshots = agentTargetsQuery.data || [];
    return snapshots.map((target): ConversationTargetSummary => ({
      id: target.agentId,
      source: 'agent' as const,
      canonicalSessionId: target.agentId,
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
  }, [agentTargetsQuery.data]);

  const groupTargets = useMemo(() => {
    const items = ((groupChatsQuery.data as { items?: GroupChatViewDto[] } | undefined)?.items || []) as GroupChatViewDto[];
    return [...items].sort(compareGroupChatsByRecency).map(toGroupTargetSummary);
  }, [groupChatsQuery.data]);

  const aiTarget = useMemo((): ConversationTargetSummary => ({
    id: 'ai:assistant',
    source: 'ai' as const,
    canonicalSessionId: 'ai:assistant',
    title: t('Chat.nimiAssistant', { defaultValue: 'Nimi' }),
    handle: null,
    bio: null,
    avatarUrl: null,
    avatarFallback: 'AI',
    previewText: null,
    updatedAt: null,
    unreadCount: 0,
    status: 'active' as const,
    isOnline: null,
    metadata: {},
  }), [t]);

  return useMemo(
    () => [...humanTargets, aiTarget, ...agentTargets, ...groupTargets],
    [humanTargets, aiTarget, agentTargets, groupTargets],
  );
}
