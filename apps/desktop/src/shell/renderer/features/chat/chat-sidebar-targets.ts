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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toAtHandle(value: unknown): string | null {
  const handle = normalizeText(value).replace(/^@+/, '');
  return handle ? `@${handle}` : null;
}

export function toHumanFriendTargetSummary(
  friend: unknown,
  options: { unknownTitle?: string } = {},
): ConversationTargetSummary | null {
  if (!friend || typeof friend !== 'object') {
    return null;
  }
  const record = friend as Record<string, unknown>;
  if (record.isAgent === true) {
    return null;
  }
  const targetId = normalizeText(record.id);
  if (!targetId) {
    return null;
  }
  const title = normalizeText(record.displayName)
    || normalizeText(record.name)
    || normalizeText(record.handle)
    || options.unknownTitle
    || 'Unknown';
  return {
    id: targetId,
    source: 'human',
    canonicalSessionId: targetId,
    title,
    handle: toAtHandle(record.handle),
    bio: normalizeText(record.bio) || null,
    avatarUrl: normalizeText(record.avatarUrl) || null,
    avatarFallback: title.charAt(0).toUpperCase() || 'H',
    previewText: null,
    updatedAt: null,
    unreadCount: 0,
    status: 'active',
    isOnline: null,
    metadata: {
      otherUserId: targetId,
      friendshipOnly: true,
    },
  };
}

export function toHumanFriendTargetsFromSocialSnapshot(
  snapshot: { friends?: readonly unknown[] } | null | undefined,
  options: { unknownTitle?: string } = {},
): ConversationTargetSummary[] {
  const friends = Array.isArray(snapshot?.friends) ? snapshot.friends : [];
  return friends
    .map((friend) => toHumanFriendTargetSummary(friend, options))
    .filter((target): target is ConversationTargetSummary => Boolean(target))
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function mergeHumanChatTargetsWithFriendTargets(
  chatTargets: readonly ConversationTargetSummary[],
  friendTargets: readonly ConversationTargetSummary[],
): ConversationTargetSummary[] {
  const existingTargetIds = new Set(chatTargets.map((target) => target.id).filter(Boolean));
  return [
    ...chatTargets,
    ...friendTargets.filter((target) => !existingTargetIds.has(target.id)),
  ];
}

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
      return toAgentFriendTargetsFromSocialSnapshot({ ...snapshot, ownerUserId });
    },
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });

  const socialSnapshotQuery = useQuery({
    queryKey: ['contacts', authStatus],
    queryFn: async () => realmSocialData.loadSocialSnapshot() as Promise<SocialSnapshot>,
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });

  const humanTargets = useMemo(() => {
    const allChats = ((humanChatsQuery.data as { items?: RealmChatViewDto[] } | undefined)?.items || []) as RealmChatViewDto[];
    const sorted = [...allChats].sort(compareRealmHumanChatsByRecency);
    const collapsed = collapseRealmHumanChatsToTargets(sorted);
    const chatTargets = collapsed.map((chat) => toRealmHumanTargetSummary(chat, {
      noMessagesFallback: t('Chat.noMessages', { defaultValue: 'No messages yet' }),
      unknownTitle: t('Common.unknown', { defaultValue: 'Unknown' }),
    }));
    const friendTargets = toHumanFriendTargetsFromSocialSnapshot(socialSnapshotQuery.data, {
      unknownTitle: t('Common.unknown', { defaultValue: 'Unknown' }),
    });
    return mergeHumanChatTargetsWithFriendTargets(chatTargets, friendTargets);
  }, [humanChatsQuery.data, socialSnapshotQuery.data, t]);

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
