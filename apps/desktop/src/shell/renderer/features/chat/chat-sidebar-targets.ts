import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import type { RealmSocialData } from '../social/data/realm-social-data.js';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentReference,
  NimiLocalAppConversationClient,
} from '@nimiplatform/sdk/app';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import { useAppStore, type AuthStatus } from '../../app-shell/providers/app-store';
import {
  collapseRealmHumanChatsToTargets,
  compareRealmHumanChatsByRecency,
  toRealmHumanTargetSummary,
  type RealmChatViewDto,
} from '@nimiplatform/kit/features/chat/realm';
import { useRealmHumanChatData } from './data/realm-human-chat-data-context.js';
import {
  getDesktopConversationClient,
  getDesktopLocalAgentReferencesClient,
} from '../../infra/sdk/desktop-nimi-client-session.js';

type SocialSnapshot = Awaited<ReturnType<RealmSocialData['loadSocialSnapshot']>>;

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

export function toHumanFriendTargetSummary(
  friend: unknown,
  options: { unknownTitle?: string } = {},
): ConversationTargetSummary | null {
  if (!friend || typeof friend !== 'object') {
    return null;
  }
  const record = friend as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, 'isSource')
    || record.sourceRef != null
    || record.runtimeSourceRef != null
    || record.localAgentRef != null
    || record.sourceKind != null
    || record.sourceId != null
    || record.source != null) {
    return null;
  }
  const targetId = normalizeText(record.id);
  if (!targetId
    || targetId.startsWith('local-agent:')
    || targetId.startsWith('runtime-source:')) {
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

export function toAgentTargetSnapshotFromSummary(
  target: ConversationTargetSummary | null | undefined,
): AgentLocalTargetSnapshot | null {
  if (!target || target.source !== 'agent') {
    return null;
  }
  const metadata = target.metadata || {};
  const agentHandle = normalizeText(metadata.agentHandle);
  const conversationAnchorId = normalizeText(metadata.conversationAnchorId);
  const displayName = normalizeText(metadata.displayName) || normalizeText(target.title);
  if (!agentHandle || !conversationAnchorId || !displayName) return null;
  return {
    agentHandle,
    conversationAnchorId,
    displayName,
    handle: normalizeText(target.handle),
    avatarUrl: nullableText(target.avatarUrl),
    worldId: null,
    worldName: null,
    bio: nullableText(target.bio),
    ownershipType: null,
    greeting: null,
    builtinDocsContext: null,
  };
}

export async function openAgentTargetSnapshotFromSummary(
  target: ConversationTargetSummary | null | undefined,
  conversation: Pick<NimiLocalAppConversationClient, 'open'> = getDesktopConversationClient(),
): Promise<AgentLocalTargetSnapshot | null> {
  if (!target || target.source !== 'agent') return null;
  const agentHandle = normalizeText(target.metadata?.agentHandle) as NimiLocalAppAgentHandle;
  if (!agentHandle) return null;
  const opened = await conversation.open({ agentHandle });
  return toAgentTargetSnapshotFromSummary({
    ...target,
    canonicalSessionId: opened.conversationAnchorId,
    metadata: {
      ...(target.metadata || {}),
      agentHandle,
      conversationAnchorId: opened.conversationAnchorId,
    },
  });
}

// @nimi-authority: rule.nimi.desktop.agent-projection.r025
export function toAgentReferenceTargetSummary(
  reference: NimiLocalAppAgentReference,
): ConversationTargetSummary {
  return {
    id: reference.agentHandle,
    source: 'agent',
    canonicalSessionId: reference.agentHandle,
    title: reference.displayName,
    handle: null,
    bio: null,
    avatarUrl: reference.avatarUrl,
    avatarFallback: reference.displayName.charAt(0).toUpperCase() || 'A',
    previewText: null,
    updatedAt: null,
    unreadCount: 0,
    status: 'active',
    isOnline: null,
    metadata: {
      agentHandle: reference.agentHandle,
      displayName: reference.displayName,
      avatarUrl: reference.avatarUrl,
    },
  };
}

export function useChatTargetsForSidebar(
  authStatus: AuthStatus,
): readonly ConversationTargetSummary[] {
  const realmHumanChatData = useRealmHumanChatData();
  const realmSocialData = useRealmSocialData();
  const { t } = useTranslation();
  const ownerUserId = useAppStore((state) => normalizeText(state.auth.user?.id));

  const humanChatsQuery = useQuery({
    queryKey: ['chats', authStatus],
    queryFn: async () => realmHumanChatData.loadChatList(),
    enabled: authStatus === 'authenticated' && Boolean(ownerUserId),
    staleTime: 30_000,
  });

  const socialSnapshotQuery = useQuery({
    queryKey: ['contacts', authStatus],
    queryFn: async () => realmSocialData.loadSocialSnapshot() as Promise<SocialSnapshot>,
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });

  const localAgentReferencesQuery = useQuery({
    queryKey: ['desktop-local-app-agent-references', authStatus, ownerUserId],
    queryFn: async () => getDesktopLocalAgentReferencesClient().listReferences(),
    enabled: authStatus === 'authenticated' && Boolean(ownerUserId),
    staleTime: 15_000,
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
    return (localAgentReferencesQuery.data || [])
      .map(toAgentReferenceTargetSummary)
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [localAgentReferencesQuery.data]);

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
    () => [...humanTargets, aiTarget, ...agentTargets],
    [humanTargets, aiTarget, agentTargets],
  );
}
