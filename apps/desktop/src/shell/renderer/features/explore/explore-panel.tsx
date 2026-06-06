import { useCallback, useMemo, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { realmExploreData } from './data/realm-explore-data';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { ProfileDetailModal } from '@renderer/features/relationship/profile-detail-modal.js';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import { ExploreView } from './explore-view';
import type { ExploreAgentCardData } from './explore-cards';
import type { ExploreSectionId } from './explore-section-nav';
import type { PostCardAuthorProfileTarget } from '../home/post-card';
import { parseAgents, toProfileTargetFromAgent } from './explore-agent-projection';
import { toWorldListItemFromTruth } from '../world/world-list-model';
import {
  fetchWorldListItems,
  prefetchWorldDetailAndHistory,
  worldListQueryKey,
} from '../world/world-detail-queries.js';
import { prefetchWorldDetailPanel } from '../world/world-detail-route-state';
import { QuickAddFriendModal } from './quick-add-friend-modal';
import { resolveAgentFriendLimit } from '../relationship/agent-friend-limit';
import {
  loadRealmAgentSocialProjection,
  realmAgentSocialProjectionQueryKey,
  resolveRealmAgentFriendState,
} from './realm-agent-friend-state';
import { addRealmAgentFriend, openRealmAgentLocalChat } from './realm-agent-friend-actions';

type PostDto = RealmModel<'PostDto'>;

const PAGE_SIZE = 20;
const DEFAULT_CATEGORIES = ['Research', 'Coding', 'Writing', 'Analysis', 'Creative', 'Education', 'Health & Finance'];

function toRecord(value: unknown): JsonObject | null {
  return parseOptionalJsonObject(value) ?? null;
}

type ExplorePanelProps = {
  activeSection: ExploreSectionId;
  searchText: string;
};

export function ExplorePanel(props: ExplorePanelProps) {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProfileTarget, setSelectedProfileTarget] = useState<PostCardAuthorProfileTarget | null>(null);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);

  // Fetch worlds for banner carousel
  const worldsQuery = useQuery({
    queryKey: worldListQueryKey(),
    queryFn: async () => (await fetchWorldListItems()).map((item) => toWorldListItemFromTruth(item)),
    staleTime: 30_000,
  });

  const worldBanners = useMemo(() => {
    const worlds = worldsQuery.data ?? [];
    // Sort: OASIS world first, then by name for consistent ordering
    const sortedWorlds = [...worlds].sort((a, b) => {
      if (a.type === 'OASIS' && b.type !== 'OASIS') return -1;
      if (a.type !== 'OASIS' && b.type === 'OASIS') return 1;
      return a.name.localeCompare(b.name);
    });
    return sortedWorlds.map((world) => ({
      id: world.id,
      name: world.name,
      bannerUrl: world.bannerUrl,
      type: world.type,
      tagline: world.tagline ?? null,
      eraLabel: world.computed?.time?.eraLabel ?? null,
      currentLabel: world.computed?.time?.currentLabel ?? world.computed?.time?.currentWorldTime ?? null,
      flowRatio: typeof world.computed?.time?.flowRatio === 'number' ? world.computed.time.flowRatio : null,
      agentCount: typeof world.agentCount === 'number' ? world.agentCount : null,
    }));
  }, [worldsQuery.data]);

  // Create worlds map for agent mapping
  const worldsMap = useMemo(() => {
    const worlds = worldsQuery.data ?? [];
    return new Map(worlds.map((w) => [w.id, { bannerUrl: w.bannerUrl, scoreEwma: w.scoreEwma, name: w.name }]));
  }, [worldsQuery.data]);

  // Fetch agents for sidebar
  const agentsQuery = useQuery({
    queryKey: ['explore-agents', authStatus, selectedCategory, props.searchText],
    queryFn: async () => {
      const tag = selectedCategory || undefined;
      const query = props.searchText.trim() || undefined;
      return realmExploreData.loadExploreAgents({ tag, query, limit: PAGE_SIZE });
    },
    enabled: authStatus === 'authenticated',
  });

  // Realm social-truth projection (AgentFriend / Friendship graph + quota).
  // Drives every RealmAgent card's friendState (D-EXPL-005). Resolved once and
  // shared by id lookup — not guessed per card.
  const socialProjectionQuery = useQuery({
    queryKey: realmAgentSocialProjectionQueryKey,
    queryFn: async () => loadRealmAgentSocialProjection(),
    enabled: authStatus === 'authenticated',
    staleTime: 15_000,
  });

  const agents = useMemo(
    () => {
      const mapped = parseAgents(agentsQuery.data, worldsMap);
      const projection = socialProjectionQuery.data ?? null;
      return mapped.map((agent) => ({
        ...agent,
        friendState: resolveRealmAgentFriendState(agent.id, projection),
      }));
    },
    [agentsQuery.data, worldsMap, socialProjectionQuery.data],
  );

  const categories = useMemo(() => {
    const dynamicTags = new Set<string>();
    for (const agent of agents) {
      for (const tag of agent.tags) {
        const normalized = tag.trim();
        if (normalized) {
          dynamicTags.add(normalized);
        }
      }
    }
    const combined = [...DEFAULT_CATEGORIES, ...Array.from(dynamicTags)];
    return Array.from(new Set(combined)).slice(0, 16);
  }, [agents]);

  // fetchPostPage for PostFeed — PostFeed manages its own pagination internally
  const fetchPostPage = useCallback(
    async (cursor: string | null) => {
      const tag = selectedCategory || undefined;
      const result = cursor
        ? await realmExploreData.loadMoreExploreFeed(PAGE_SIZE, cursor, tag)
        : await realmExploreData.loadExploreFeed(tag ?? null, PAGE_SIZE);
      const payload = toRecord(result);
      const items = Array.isArray(payload?.items) ? (payload.items as PostDto[]) : [];
      const page = toRecord(payload?.page);
      const nextCursor =
        typeof page?.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
      return { items, nextCursor };
    },
    [selectedCategory],
  );

  // Reset PostFeed when category changes or refresh is triggered
  const [refreshKey, setRefreshKey] = useState(0);
  const postFeedKey = `explore-${selectedCategory ?? 'all'}-${refreshKey}`;

  // Add Contact Modal state
  const [addContactModalOpen, setAddContactModalOpen] = useState(false);
  const [selectedAgentForAdd, setSelectedAgentForAdd] = useState<ExploreAgentCardData | null>(null);

  // Send Gift Modal state
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [selectedAgentForGift, setSelectedAgentForGift] = useState<ExploreAgentCardData | null>(null);

  // Agent friend limit query
  const agentLimitQuery = useQuery({
    queryKey: ['agent-friend-limit'],
    queryFn: async () => resolveAgentFriendLimit(),
  });

  const onAgentAddFriend = useCallback(
    (agentId: string) => {
      const target = agents.find((item) => item.id === agentId);
      if (target) {
        setSelectedAgentForAdd(target);
        setAddContactModalOpen(true);
      }
      logRendererEvent({
        level: 'info',
        area: 'explore',
        message: 'action:agent-add-friend:clicked',
        details: {
          agentId,
          targetId: target?.id ?? null,
          targetHandle: target?.handle ?? null,
        },
      });
    },
    [agents],
  );

  // D-EXPL-007 Add Friend dual-effect: create the AgentFriend relation AND
  // ensure the idempotent account-scoped LocalAgent projection. The LocalAgent
  // projection is ensured here at Add Friend time, not deferred to first
  // chat-open. On success, the social projection is refetched so the card's
  // friendState transitions to `friend` / `pending`.
  const onAddFriend = useCallback(async (agentId: string, message?: string) => {
    if (agentLimitQuery.data && !agentLimitQuery.data.canAdd) {
      throw new Error(agentLimitQuery.data.reason || t('Relationship.agentFriendLimitReachedShort', { defaultValue: 'Agent friend limit reached' }));
    }
    const target = agents.find((item) => item.id === agentId) ?? null;
    await addRealmAgentFriend(
      {
        realmAgentId: agentId,
        displayName: target?.name ?? agentId,
        handle: target?.handle ?? '',
        avatarUrl: target?.avatarUrl ?? null,
        worldId: target?.worldId ?? null,
        worldName: target?.worldName ?? null,
        bio: target?.bio ?? null,
      },
      message,
    );
    await Promise.all([
      socialProjectionQuery.refetch(),
      agentLimitQuery.refetch(),
    ]);
    setAddContactModalOpen(false);
    setSelectedAgentForAdd(null);
  }, [agentLimitQuery, agents, socialProjectionQuery, t]);

  // `friend` → Open Agent Chat. Opens the one-to-one LocalAgent Chat for the
  // RealmAgent's deterministic localAgentRef. The only chat entry for a
  // RealmAgent — there is no RealmAgent direct chat (D-EXPL-006).
  const onAgentOpenChat = useCallback(async (agentId: string) => {
    const target = agents.find((item) => item.id === agentId);
    if (!target) {
      return;
    }
    await openRealmAgentLocalChat(
      {
        realmAgentId: target.id,
        displayName: target.name,
        handle: target.handle,
        avatarUrl: target.avatarUrl,
        worldId: target.worldId,
        worldName: target.worldName,
        bio: target.bio,
      },
      { setActiveTab, setChatMode, setSelectedTargetForSource, setAgentConversationSelection },
    );
  }, [agents, setActiveTab, setChatMode, setSelectedTargetForSource, setAgentConversationSelection]);

  // `limit_reached` stays inline. Keep the
  // action fail-closed until an in-context management action is admitted.
  const onAgentManageFriends = useCallback(() => {
    setFeedback({
      kind: 'warning',
      message: t('Explore.agentFriendLimitManagementUnavailable', {
        defaultValue: 'Agent friend limit reached. Remove an agent friend from a profile before adding another.',
      }),
    });
  }, [t]);

  const onAgentSendGift = useCallback(
    (agentId: string) => {
      const target = agents.find((item) => item.id === agentId);
      if (target) {
        setSelectedAgentForGift(target);
        setGiftModalOpen(true);
      }
    },
    [agents],
  );

  const onToggleCategory = useCallback(
    (category: string) => {
      if (category === '') {
        setSelectedCategory(null);
      } else {
        setSelectedCategory((current) => (current === category ? null : category));
      }
    },
    [],
  );

  const onWorldOpen = useCallback(
    (worldId: string) => {
      prefetchWorldDetailPanel();
      prefetchWorldDetailAndHistory(worldId);
      navigateToWorld(worldId);
    },
    [navigateToWorld],
  );

  const onAgentOpen = useCallback(
    (agentId: string) => {
      const target = agents.find((item) => item.id === agentId) || null;
      if (!target) {
        return;
      }
      setSelectedProfileTarget(toProfileTargetFromAgent(target));
    },
    [agents],
  );

  const agentLimit = agentLimitQuery.data ?? null;

  return (
    <>
      <InlineFeedback
        feedback={feedback}
        onDismiss={() => setFeedback(null)}
        className="absolute left-1/2 top-20 z-30 w-[min(720px,calc(100vw-160px))] -translate-x-1/2 shadow-[0_18px_48px_rgba(15,23,42,0.16)]"
      />
      <ExploreView
        selectedCategory={selectedCategory}
        categories={categories}
        agents={agents}
        worldBanners={worldBanners}
        worldCatalogItems={worldsQuery.data ?? []}
        worldsLoading={worldsQuery.isPending}
        worldsError={worldsQuery.isError}
        activeSection={props.activeSection}
        fetchPostPage={fetchPostPage}
        postFeedKey={postFeedKey}
        onPostDelete={() => setRefreshKey((k) => k + 1)}
        loading={agentsQuery.isPending}
        onToggleCategory={onToggleCategory}
        onAgentAddFriend={onAgentAddFriend}
        onAgentOpenChat={onAgentOpenChat}
        onAgentManageFriends={onAgentManageFriends}
        onAgentSendGift={onAgentSendGift}
        onAgentOpen={onAgentOpen}
        onPostAuthorOpen={setSelectedProfileTarget}
        onWorldOpen={onWorldOpen}
      />
      <QuickAddFriendModal
        open={addContactModalOpen}
        agent={selectedAgentForAdd}
        agentLimit={agentLimit}
        onClose={() => {
          setAddContactModalOpen(false);
          setSelectedAgentForAdd(null);
        }}
        onAdd={onAddFriend}
      />
      <SendGiftModal
        open={giftModalOpen}
        receiverId={selectedAgentForGift?.id || ''}
        receiverName={selectedAgentForGift?.name || 'Agent'}
        receiverHandle={selectedAgentForGift?.handle}
        receiverIsAgent={selectedAgentForGift?.isAgent === true}
        receiverAvatarUrl={selectedAgentForGift?.avatarUrl}
        onClose={() => {
          setGiftModalOpen(false);
          setSelectedAgentForGift(null);
        }}
        onSent={() => {
          setGiftModalOpen(false);
          setSelectedAgentForGift(null);
        }}
      />
      <ProfileDetailModal
        open={Boolean(selectedProfileTarget)}
        profileId={selectedProfileTarget?.profileId || ''}
        profileSeed={selectedProfileTarget?.profileSeed || null}
        onClose={() => setSelectedProfileTarget(null)}
      />
    </>
  );
}
