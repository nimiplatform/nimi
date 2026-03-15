import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { ContactDetailProfileModal, type ContactDetailProfileSeed } from '@renderer/features/contacts/contact-detail-profile-modal.js';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { ExploreView } from './explore-view';
import type { ExploreAgentCardData, FeaturedWorldCardData } from './explore-cards';
import type { PostCardAuthorProfileTarget } from '../home/post-card';
import { toWorldListItem } from '../world/world-list-model';
import { prefetchWorldDetailAndEvents } from '../world/world-detail-queries.js';
import { prefetchWorldDetailPanel } from '../world/world-detail-route-state';
import { QuickAddFriendModal } from './quick-add-friend-modal';
import { resolveAgentFriendLimit } from '../contacts/agent-friend-limit';

const PAGE_SIZE = 20;
const DEFAULT_CATEGORIES = ['Research', 'Coding', 'Writing', 'Analysis', 'Creative', 'Education', 'Health & Finance'];
const TOP_AGENTS_COUNT = 5;

const DEFAULT_FEATURED_WORLDS: FeaturedWorldCardData[] = [
  {
    id: 'coding-world',
    title: 'Coding World',
    subtitle: 'Build & Automate',
    imageUrl: null,
    gradient: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)',
    creatorAvatarUrl: null,
  },
  {
    id: 'creative-world',
    title: 'Creative World',
    subtitle: 'Art, Music & Stories',
    imageUrl: null,
    gradient: 'linear-gradient(135deg, #4a0e4e 0%, #c94b4b 100%)',
    creatorAvatarUrl: null,
  },
  {
    id: 'research-world',
    title: 'Research World',
    subtitle: 'Discuss & Stories',
    imageUrl: null,
    gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    creatorAvatarUrl: null,
  },
];

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function mapAgent(raw: unknown, worldsMap: Map<string, { bannerUrl: string | null; scoreEwma: number; name?: string }>): ExploreAgentCardData | null {
  const source = toRecord(raw);
  if (!source) {
    return null;
  }
  const id = asString(source.id).trim();
  if (!id) {
    return null;
  }

  const agent = toRecord(source.agent);
  const agentProfile = toRecord(source.agentProfile);
  const stats = toRecord(source.stats);
  
  // Basic info
  const displayName = asString(source.displayName).trim()
    || asString(source.name).trim()
    || asString(agentProfile?.displayName).trim()
    || asString(source.handle).trim()
    || asString(agentProfile?.handle).trim()
    || 'Unknown Agent';
  const handle = asString(source.handle).trim()
    || asString(agentProfile?.handle).trim()
    || displayName;
  const avatarUrl = asString(source.avatarUrl).trim()
    || asString(agentProfile?.avatarUrl).trim()
    || null;
  const bio = asString(source.bio).trim()
    || asString(agentProfile?.bio).trim()
    || null;
  const isAgent = source.isAgent === true || Boolean(agent) || Boolean(agentProfile);
  const isOnline = source.isOnline === true;
  
  // Agent fields
  const category = asString(agent?.category).trim()
    || asString(agentProfile?.category).trim()
    || asString(source.category).trim();
  const origin = asString(agent?.origin).trim()
    || asString(agentProfile?.origin).trim()
    || asString(source.origin).trim();
  const tier = asString(agent?.tier).trim()
    || asString(agentProfile?.tier).trim()
    || asString(source.tier).trim();
  const state = asString(agent?.state).trim()
    || asString(agentProfile?.state).trim()
    || asString(source.state).trim();
  const wakeStrategy = asString(agent?.wakeStrategy).trim()
    || asString(agentProfile?.wakeStrategy).trim();
  const ownershipType = asString(agent?.ownershipType || agentProfile?.ownershipType).trim();
  const accountVisibility = asString(source.accountVisibility).trim()
    || asString(agent?.accountVisibility).trim()
    || asString(agentProfile?.accountVisibility).trim()
    || null;
  
  // Tags - combine category, origin, and any custom tags
  const customTags = Array.isArray(source.tags) 
    ? source.tags.map(String).filter(Boolean)
    : [];
  const tags = [category, origin, wakeStrategy].filter(Boolean).concat(customTags);
  
  // World info
  const worldId = asString(agent?.worldId).trim()
    || asString(agentProfile?.worldId).trim()
    || null;
  const worldData = worldId ? worldsMap.get(worldId) : null;
  const worldBannerUrl = worldData?.bannerUrl ?? null;
  const worldName = worldData?.name ?? null;
  const worldScoreEwma = worldData?.scoreEwma ?? 0;
  
  // Stats
  const friendsCount = asNumber(stats?.friendsCount)
    ?? asNumber(source.friendsCount)
    ?? asNumber(source.friendCount);
  const postsCount = asNumber(stats?.postsCount)
    ?? asNumber(source.postsCount)
    ?? asNumber(source.postCount);
  const likesCount = asNumber(stats?.likesCount)
    ?? asNumber(source.likesCount)
    ?? asNumber(source.likeCount);
  const giftStats = typeof source.giftStats === 'object' && source.giftStats !== null
    ? source.giftStats as Record<string, number>
    : undefined;

  return {
    // Basic contact info
    id,
    name: displayName,
    handle,
    avatarUrl,
    bio,
    isAgent,
    // World info
    worldId,
    worldName,
    worldBannerUrl,
    // Agent specific fields
    category,
    origin,
    tier,
    state,
    ownershipType,
    wakeStrategy,
    accountVisibility,
    isOnline,
    // Social/Stats
    tags,
    friendsCount,
    postsCount,
    likesCount,
    giftStats,
    // World score
    worldScoreEwma,
  };
}

function parseAgents(agentsResult: unknown, worldsMap: Map<string, { bannerUrl: string | null; scoreEwma: number; name?: string }>): ExploreAgentCardData[] {
  const payload = toRecord(agentsResult);
  const raw = Array.isArray(payload?.items) ? payload.items : [];
  return raw
    .map((item) => mapAgent(item, worldsMap))
    .filter((item): item is ExploreAgentCardData => item !== null);
}

function toProfileTargetFromAgent(agent: ExploreAgentCardData): PostCardAuthorProfileTarget {
  const profileSeed: ContactDetailProfileSeed = {
    id: agent.id,
    displayName: agent.name,
    handle: agent.handle,
    avatarUrl: agent.avatarUrl,
    bio: agent.bio,
    isAgent: agent.isAgent,
    isOnline: agent.isOnline,
    tags: agent.tags,
    worldName: agent.worldName,
    worldBannerUrl: agent.worldBannerUrl,
    friendsCount: agent.friendsCount,
    postsCount: agent.postsCount,
    likesCount: agent.likesCount,
    giftStats: agent.giftStats,
    agentState: agent.state,
    agentCategory: agent.category,
    agentOrigin: agent.origin,
    agentTier: agent.tier,
    agentWakeStrategy: agent.wakeStrategy,
    agentOwnershipType: agent.ownershipType,
    agentWorldId: agent.worldId,
  };
  return {
    profileId: agent.id,
    profileSeed,
  };
}

export function ExplorePanel() {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProfileTarget, setSelectedProfileTarget] = useState<PostCardAuthorProfileTarget | null>(null);

  // Fetch worlds for banner carousel
  const worldsQuery = useQuery({
    queryKey: ['explore-worlds'],
    queryFn: async () => {
      const result = await dataSync.loadWorlds();
      return Array.isArray(result)
        ? result.map((item) => toWorldListItem(item as Record<string, unknown>))
        : [];
    },
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
    }));
  }, [worldsQuery.data]);

  // Create worlds map for agent mapping
  const worldsMap = useMemo(() => {
    const worlds = worldsQuery.data ?? [];
    return new Map(worlds.map((w) => [w.id, { bannerUrl: w.bannerUrl, scoreEwma: w.scoreEwma, name: w.name }]));
  }, [worldsQuery.data]);

  // Fetch agents for sidebar
  const agentsQuery = useQuery({
    queryKey: ['explore-agents', authStatus, selectedCategory, searchText],
    queryFn: async () => {
      const tag = selectedCategory || undefined;
      const query = searchText.trim() || undefined;
      const result = await dataSync.callApi((realm) => realm.services.SearchService.searchUsers(
        PAGE_SIZE,
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        undefined,
        tag,
        undefined,
        undefined,
        undefined,
        undefined,
        query,
      ));
      return parseAgents(result, worldsMap);
    },
    enabled: authStatus === 'authenticated',
  });

  const agents = agentsQuery.data ?? [];
  
  // Refetch agents when worlds data is loaded to ensure worldBannerUrl is populated
  useEffect(() => {
    if (worldsQuery.data && agentsQuery.data) {
      agentsQuery.refetch();
    }
  }, [worldsQuery.data]);

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

  const topAgents = useMemo(
    () => agents.slice(0, TOP_AGENTS_COUNT),
    [agents],
  );

  // fetchPostPage for PostFeed — PostFeed manages its own pagination internally
  const fetchPostPage = useCallback(
    async (cursor: string | null) => {
      const tag = selectedCategory || undefined;
      const result = await dataSync.callApi((realm) => realm.services.ExploreService.getExploreFeed(undefined, tag, PAGE_SIZE, cursor ?? undefined),
      );
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

  const onAddFriend = useCallback(async (agentId: string, message?: string) => {
    if (agentLimitQuery.data && !agentLimitQuery.data.canAdd) {
      throw new Error(agentLimitQuery.data.reason || t('Contacts.agentFriendLimitReachedShort', { defaultValue: 'Agent friend limit reached' }));
    }
    await dataSync.requestOrAcceptFriend(agentId, message);
    setAddContactModalOpen(false);
    setSelectedAgentForAdd(null);
  }, [agentLimitQuery.data, t]);

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
      prefetchWorldDetailAndEvents(worldId);
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
      <ExploreView
        searchText={searchText}
        selectedCategory={selectedCategory}
        categories={categories}
        featuredWorlds={DEFAULT_FEATURED_WORLDS}
        topAgents={topAgents}
        worldBanners={worldBanners}
        fetchPostPage={fetchPostPage}
        postFeedKey={postFeedKey}
        onPostDelete={() => setRefreshKey((k) => k + 1)}
        loading={agentsQuery.isPending}
        onSearchTextChange={setSearchText}
        onToggleCategory={onToggleCategory}
        onAgentAddFriend={onAgentAddFriend}
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
          setStatusBanner({
            kind: 'success',
            message: t('Contacts.giftSentTo', {
              name: selectedAgentForGift?.name || t('Contacts.agent', { defaultValue: 'Agent' }).toLowerCase(),
              defaultValue: 'Gift sent to {{name}}',
            }),
          });
          setGiftModalOpen(false);
          setSelectedAgentForGift(null);
        }}
      />
      <ContactDetailProfileModal
        open={Boolean(selectedProfileTarget)}
        profileId={selectedProfileTarget?.profileId || ''}
        profileSeed={selectedProfileTarget?.profileSeed || null}
        onClose={() => setSelectedProfileTarget(null)}
      />
    </>
  );
}
