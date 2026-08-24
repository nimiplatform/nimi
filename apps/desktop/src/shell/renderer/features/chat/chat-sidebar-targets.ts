import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import type { RealmSocialData } from '../social/data/realm-social-data.js';
import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { isRuntimeLocalAgentRef } from '@nimiplatform/sdk/runtime';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import { useAppStore, type AuthStatus } from '../../app-shell/providers/app-store';
import {
  fetchLocalAgentList,
  localAgentListQueryKey,
  type LocalAgentListItem,
} from '../agents/local-agent-list-model';
import {
  fetchSourceDisplayDetail,
  sourceDisplayDetailQueryKey,
} from '../source-detail/source-detail-queries';
import type { SourceDetailData } from '../source-detail/source-detail-model.js';
import {
  fetchWorldListItems,
  worldListQueryKey,
} from '../world/world-detail-queries';
import {
  collapseRealmHumanChatsToTargets,
  compareRealmHumanChatsByRecency,
  toRealmHumanTargetSummary,
  type RealmChatViewDto,
} from '@nimiplatform/kit/features/chat/realm';
import { useRealmHumanChatData } from './data/realm-human-chat-data-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { createRealmWorldData } from '../world/data/realm-world-data.js';
import { resolveCharacterSourceRefV3 } from '../explore/character-source-materialization.js';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';

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

function readSourceCharacterGreeting(source: SourceDetailData | null): string | null {
  return nullableText(source?.characterProfile.interaction?.greeting);
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

function toAgentTargetSummary(
  snapshot: AgentLocalTargetSnapshot,
  sourceRef: CharacterSourceRefV3,
): ConversationTargetSummary {
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
      greeting: snapshot.greeting,
      builtinDocsContext: snapshot.builtinDocsContext,
      sourceRef,
    },
  };
}

export function toAgentTargetsFromLocalAgentList(
  agents: readonly LocalAgentListItem[],
  worldNameById: ReadonlyMap<string, string> = new Map(),
  sourceDetailBySourceKey: ReadonlyMap<string, SourceDetailData | null> = new Map(),
): ConversationTargetSummary[] {
  return agents
    .map((agent) => {
      const source = sourceDetailBySourceKey.get(agent.sourceKey) ?? null;
      return toAgentTargetSummary({
        ownerUserId: agent.ownerUserId,
        runtimeSourceRef: agent.runtimeSourceRef,
        localAgentRef: agent.localAgentRef,
        displayName: source?.displayName || agent.displayName,
        handle: source?.handle || agent.sourceRef.id,
        avatarUrl: source?.avatarUrl ?? null,
        worldId: source?.worldId || agent.sourceRef.worldId,
        worldName: worldNameById.get(source?.worldId || agent.sourceRef.worldId) || null,
        bio: source?.bio ?? null,
        ownershipType: null,
        greeting: readSourceCharacterGreeting(source),
        builtinDocsContext: null,
      }, agent.sourceRef);
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function toAgentTargetSnapshotFromSummary(
  target: ConversationTargetSummary | null | undefined,
): AgentLocalTargetSnapshot | null {
  if (!target || target.source !== 'agent') {
    return null;
  }
  const metadata = target.metadata || {};
  const sourceRef = resolveCharacterSourceRefV3({ sourceRef: metadata.sourceRef });
  const ownerUserId = normalizeText(metadata.ownerUserId);
  const runtimeSourceRef = normalizeText(metadata.runtimeSourceRef);
  const localAgentRef = normalizeText(metadata.localAgentRef);
  if (!sourceRef || !ownerUserId || !runtimeSourceRef || !localAgentRef) {
    return null;
  }
  if (!isRuntimeLocalAgentRef(localAgentRef)
    || normalizeText(target.id) !== localAgentRef) {
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
    sourceRef,
    displayName,
    handle: normalizeText(metadata.handle),
    avatarUrl: nullableText(metadata.avatarUrl),
    worldId: nullableText(metadata.worldId),
    worldName: nullableText(metadata.worldName),
    bio: nullableText(metadata.bio),
    ownershipType: null,
    greeting: nullableText(metadata.greeting),
    builtinDocsContext: nullableText(metadata.builtinDocsContext),
  };
}

export function useChatTargetsForSidebar(
  authStatus: AuthStatus,
): readonly ConversationTargetSummary[] {
  const realmHumanChatData = useRealmHumanChatData();
  const bindings = useDesktopRendererBindings();
  const realmSocialData = useRealmSocialData();
  const { t } = useTranslation();
  const ownerUserId = useAppStore((state) => normalizeText(state.auth.user?.id));

  const humanChatsQuery = useQuery({
    queryKey: ['chats', authStatus],
    queryFn: async () => realmHumanChatData.loadChatList(),
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });

  const socialSnapshotQuery = useQuery({
    queryKey: ['contacts', authStatus],
    queryFn: async () => realmSocialData.loadSocialSnapshot() as Promise<SocialSnapshot>,
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });

  const worldsQuery = useQuery({
    queryKey: worldListQueryKey(),
    queryFn: async () => fetchWorldListItems(createRealmWorldData(bindings.sdk)),
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });

  const localAgentsQuery = useQuery({
    queryKey: localAgentListQueryKey(ownerUserId),
    queryFn: async () => fetchLocalAgentList(ownerUserId, bindings.sdk),
    enabled: authStatus === 'authenticated' && Boolean(ownerUserId),
    staleTime: 15_000,
  });
  const localAgents = localAgentsQuery.data ?? [];

  const localAgentSourceDetailQueries = useQueries({
    queries: localAgents.map((agent) => ({
      queryKey: sourceDisplayDetailQueryKey(agent.sourceRef),
      queryFn: async () => fetchSourceDisplayDetail(agent.sourceRef, bindings.sdk),
      enabled: authStatus === 'authenticated',
      staleTime: 60_000,
    })),
  });

  const worldNameById = useMemo(() => {
    const worlds = worldsQuery.data ?? [];
    return new Map(worlds.map((world) => [world.id, world.name]));
  }, [worldsQuery.data]);

  const sourceDetailBySourceKey = useMemo(() => {
    const bySourceKey = new Map<string, SourceDetailData | null>();
    for (const [index, agent] of localAgents.entries()) {
      bySourceKey.set(agent.sourceKey, localAgentSourceDetailQueries[index]?.data?.source ?? null);
    }
    return bySourceKey;
  }, [localAgents, localAgentSourceDetailQueries]);

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
    return toAgentTargetsFromLocalAgentList(localAgents, worldNameById, sourceDetailBySourceKey);
  }, [localAgents, sourceDetailBySourceKey, worldNameById]);

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
