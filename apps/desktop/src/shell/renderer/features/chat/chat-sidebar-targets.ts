import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import {
  collapseRealmHumanChatsToTargets,
  compareRealmHumanChatsByRecency,
  toRealmHumanTargetSummary,
  type RealmChatViewDto,
} from '@nimiplatform/kit/features/chat/realm';
import { loadChatList } from './data/realm-human-chat-data';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { realmGroupChatData } from './data/realm-group-chat-data';
import {
  toAgentFriendTargetsFromSocialSnapshot,
} from './chat-agent-thread-model';
import { TARGETS_QUERY_KEY } from './chat-agent-shell-core';
import {
  compareGroupChatsByRecency,
  toGroupTargetSummary,
  type GroupChatViewDto,
} from './chat-group-thread-model';

type SocialSnapshot = Awaited<ReturnType<typeof realmSocialData.loadSocialSnapshot>>;

export function useChatTargetsForSidebar(
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated',
): readonly ConversationTargetSummary[] {
  const { t } = useTranslation();
  const ownerUserId = useAppStore((state) => String((state.auth.user as Record<string, unknown> | null)?.id || '').trim());

  const humanChatsQuery = useQuery({
    queryKey: ['chats', authStatus],
    queryFn: async () => loadChatList(),
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });

  const groupChatsQuery = useQuery({
    queryKey: ['group-chats', authStatus],
    queryFn: async () => realmGroupChatData.loadGroupChats(),
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });

  const agentTargetsQuery = useQuery({
    queryKey: [...TARGETS_QUERY_KEY, authStatus],
    queryFn: async (): Promise<ReturnType<typeof toAgentFriendTargetsFromSocialSnapshot>> => {
      const snapshot = await realmSocialData.loadSocialSnapshot() as SocialSnapshot;
      return toAgentFriendTargetsFromSocialSnapshot({ ...((snapshot as Record<string, unknown> | null) || {}), ownerUserId });
    },
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });

  const humanTargets = useMemo(() => {
    const allChats = ((humanChatsQuery.data as { items?: RealmChatViewDto[] } | undefined)?.items || []) as RealmChatViewDto[];
    const sorted = [...allChats].sort(compareRealmHumanChatsByRecency);
    const collapsed = collapseRealmHumanChatsToTargets(sorted);
    return collapsed.map((chat) => toRealmHumanTargetSummary(chat, {
      noMessagesFallback: t('Chat.noMessages', { defaultValue: 'No messages yet' }),
      unknownTitle: t('Common.unknown', { defaultValue: 'Unknown' }),
    }));
  }, [humanChatsQuery.data, t]);

  const agentTargets = useMemo(() => {
    const snapshots = agentTargetsQuery.data || [];
    return snapshots.map((target): ConversationTargetSummary => ({
      id: target.localAgentRef,
      source: 'agent' as const,
      canonicalSessionId: target.localAgentRef,
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
        realmAgentId: target.realmAgentId,
        localAgentRef: target.localAgentRef,
        ownerUserId: target.ownerUserId,
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
