import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { isRuntimeLocalAgentRef } from '@nimiplatform/sdk/runtime';
import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { toSourceContactLaunchTarget } from '@renderer/features/relationship/source-contact-launch-target';
import {
  collapseRealmHumanChatsToTargets,
  compareRealmHumanChatsByRecency,
  toRealmHumanTargetSummary,
  type RealmChatViewDto,
} from '@nimiplatform/kit/features/chat/realm';
import { loadChatList } from './data/realm-human-chat-data';
import { realmGroupChatData } from './data/realm-group-chat-data';
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

function nullableText(value: unknown): string | null {
  return normalizeText(value) || null;
}

function normalizeOwnershipType(value: unknown): AgentLocalTargetSnapshot['ownershipType'] {
  const normalized = normalizeText(value);
  return normalized === 'MASTER_OWNED' || normalized === 'WORLD_OWNED' ? normalized : null;
}

export function toHumanFriendTargetSummary(
  friend: unknown,
  options: { unknownTitle?: string } = {},
): ConversationTargetSummary | null {
  if (!friend || typeof friend !== 'object') {
    return null;
  }
  const record = friend as Record<string, unknown>;
  if (record.isSource === true) {
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

function toAgentTargetSummary(snapshot: AgentLocalTargetSnapshot): ConversationTargetSummary {
  const title = normalizeText(snapshot.displayName) || normalizeText(snapshot.runtimeSourceRef) || 'Agent';
  const handle = normalizeText(snapshot.handle) || null;
  return {
    id: snapshot.localAgentRef,
    source: 'agent',
    canonicalSessionId: snapshot.localAgentRef,
    title,
    handle,
    bio: normalizeText(snapshot.bio) || null,
    avatarUrl: normalizeText(snapshot.avatarUrl) || null,
    avatarFallback: title.charAt(0).toUpperCase() || 'A',
    previewText: null,
    updatedAt: null,
    unreadCount: 0,
    status: 'active',
    isOnline: null,
    metadata: {
      ownerUserId: snapshot.ownerUserId,
      runtimeSourceRef: snapshot.runtimeSourceRef,
      localAgentRef: snapshot.localAgentRef,
      displayName: snapshot.displayName,
      handle: snapshot.handle,
      avatarUrl: snapshot.avatarUrl,
      worldId: snapshot.worldId,
      worldName: snapshot.worldName,
      bio: snapshot.bio,
      ownershipType: snapshot.ownershipType,
      greeting: snapshot.greeting,
      builtinDocsContext: snapshot.builtinDocsContext,
    },
  };
}

export function toAgentTargetsFromSocialSnapshot(
  snapshot: { friends?: readonly unknown[] } | null | undefined,
  ownerUserId: string | null | undefined,
): ConversationTargetSummary[] {
  const owner = normalizeText(ownerUserId);
  if (!owner) {
    return [];
  }
  const friends = Array.isArray(snapshot?.friends) ? snapshot.friends : [];
  return friends
    .map((friend) => {
      if (!friend || typeof friend !== 'object' || (friend as Record<string, unknown>).isSource !== true) {
        return null;
      }
      try {
        return toAgentTargetSummary(toSourceContactLaunchTarget(
          friend as Parameters<typeof toSourceContactLaunchTarget>[0],
          owner,
        ));
      } catch {
        return null;
      }
    })
    .filter((target): target is ConversationTargetSummary => Boolean(target))
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function toAgentTargetSnapshotFromSummary(
  target: ConversationTargetSummary | null | undefined,
): AgentLocalTargetSnapshot | null {
  if (!target || target.source !== 'agent') {
    return null;
  }
  const metadata = target.metadata || {};
  const ownerUserId = normalizeText(metadata.ownerUserId);
  const runtimeSourceRef = normalizeText(metadata.runtimeSourceRef);
  const localAgentRef = normalizeText(metadata.localAgentRef);
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef) {
    return null;
  }
  if (!isRuntimeLocalAgentRef(localAgentRef)) {
    return null;
  }
  const displayName = normalizeText(metadata.displayName) || normalizeText(target.title);
  if (!displayName) {
    return null;
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    displayName,
    handle: normalizeText(metadata.handle),
    avatarUrl: nullableText(metadata.avatarUrl),
    worldId: nullableText(metadata.worldId),
    worldName: nullableText(metadata.worldName),
    bio: nullableText(metadata.bio),
    ownershipType: normalizeOwnershipType(metadata.ownershipType),
    greeting: nullableText(metadata.greeting),
    builtinDocsContext: nullableText(metadata.builtinDocsContext),
  };
}

export function useChatTargetsForSidebar(
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated',
): readonly ConversationTargetSummary[] {
  const { t } = useTranslation();
  const ownerUserId = useAppStore((state) => normalizeText(state.auth.user?.id));

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

  const agentTargets = useMemo(
    () => toAgentTargetsFromSocialSnapshot(socialSnapshotQuery.data, ownerUserId),
    [ownerUserId, socialSnapshotQuery.data],
  );

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
