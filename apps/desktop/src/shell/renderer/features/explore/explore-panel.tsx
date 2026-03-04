import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { ExploreView } from './explore-view';
import type { ExploreAgentCardData, FeaturedWorldCardData } from './explore-cards';
import type { WorldListItem } from '../world/world-list';
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
    isPublic: true,
    creatorAvatarUrl: null,
  },
  {
    id: 'creative-world',
    title: 'Creative World',
    subtitle: 'Art, Music & Stories',
    imageUrl: null,
    gradient: 'linear-gradient(135deg, #4a0e4e 0%, #c94b4b 100%)',
    isPublic: true,
    creatorAvatarUrl: null,
  },
  {
    id: 'research-world',
    title: 'Research World',
    subtitle: 'Discuss & Stories',
    imageUrl: null,
    gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    isPublic: true,
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

function mapAgent(raw: unknown, worldsMap: Map<string, { bannerUrl: string | null; scoreEwma: number }>): ExploreAgentCardData | null {
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
  const displayName = asString(source.displayName).trim() || asString(source.handle).trim() || 'Unknown Agent';
  const handle = asString(source.handle).trim() || displayName;
  const category = asString(agent?.category).trim();
  const origin = asString(agent?.origin).trim();
  const wakeStrategy = asString(agent?.wakeStrategy).trim();
  const tags = [category, origin, wakeStrategy].filter(Boolean);
  const worldId = asString(agent?.worldId).trim()
    || asString(agentProfile?.worldId).trim()
    || null;
  
  // Get world data if worldId exists
  const worldData = worldId ? worldsMap.get(worldId) : null;
  const worldBannerUrl = worldData?.bannerUrl ?? null;
  const worldScoreEwma = worldData?.scoreEwma ?? 0;

  return {
    id,
    name: displayName,
    handle,
    avatarUrl: asString(source.avatarUrl).trim() || null,
    description: category ? `${category} agent` : 'Public agent',
    tags,
    badgeText: origin ? `Origin: ${origin}` : 'Community',
    worldId,
    worldBannerUrl,
    worldScoreEwma,
  };
}

function parseAgents(agentsResult: unknown, worldsMap: Map<string, { bannerUrl: string | null; scoreEwma: number }>): ExploreAgentCardData[] {
  const payload = toRecord(agentsResult);
  const raw = Array.isArray(payload?.items) ? payload.items : [];
  return raw
    .map((item) => mapAgent(item, worldsMap))
    .filter((item): item is ExploreAgentCardData => item !== null);
}

function toWorldListItem(raw: Record<string, unknown>): WorldListItem {
  return {
    id: String(raw.id || ''),
    name: String(raw.name || 'Unknown World'),
    description: typeof raw.description === 'string' ? raw.description : null,
    genre: typeof raw.genre === 'string' ? raw.genre : null,
    themes: Array.isArray(raw.themes)
      ? raw.themes.filter((t): t is string => typeof t === 'string')
      : [],
    era: typeof raw.era === 'string' ? raw.era : null,
    iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl : null,
    bannerUrl: typeof raw.bannerUrl === 'string' ? raw.bannerUrl : null,
    type: typeof raw.type === 'string' ? raw.type : 'SUB',
    status: typeof raw.status === 'string' ? raw.status : 'DRAFT',
    level: typeof raw.level === 'number' ? raw.level : 1,
    levelUpdatedAt: typeof raw.levelUpdatedAt === 'string' ? raw.levelUpdatedAt : null,
    agentCount: typeof raw.agentCount === 'number' ? raw.agentCount : 0,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    creatorId: typeof raw.creatorId === 'string' ? raw.creatorId : null,
    freezeReason: typeof raw.freezeReason === 'string' ? raw.freezeReason : null,
    lorebookEntryLimit: typeof raw.lorebookEntryLimit === 'number' ? raw.lorebookEntryLimit : 0,
    nativeAgentLimit: typeof raw.nativeAgentLimit === 'number' ? raw.nativeAgentLimit : 0,
    nativeCreationState:
      typeof raw.nativeCreationState === 'string' ? raw.nativeCreationState : 'OPEN',
    scoreA: typeof raw.scoreA === 'number' ? raw.scoreA : 0,
    scoreC: typeof raw.scoreC === 'number' ? raw.scoreC : 0,
    scoreE: typeof raw.scoreE === 'number' ? raw.scoreE : 0,
    scoreEwma: typeof raw.scoreEwma === 'number' ? raw.scoreEwma : 0,
    scoreQ: typeof raw.scoreQ === 'number' ? raw.scoreQ : 0,
    timeFlowRatio: typeof raw.timeFlowRatio === 'number' ? raw.timeFlowRatio : 1,
    transitInLimit: typeof raw.transitInLimit === 'number' ? raw.transitInLimit : 0,
    agents: undefined,
  };
}

export function ExplorePanel() {
  const authStatus = useAppStore((state) => state.auth.status);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const openModWorkspaceTab = useAppStore((state) => state.openModWorkspaceTab);
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

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
    // Sort: MAIN worlds first, then by name for consistent ordering
    const sortedWorlds = [...worlds].sort((a, b) => {
      if (a.type === 'MAIN' && b.type !== 'MAIN') return -1;
      if (a.type !== 'MAIN' && b.type === 'MAIN') return 1;
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
    return new Map(worlds.map((w) => [w.id, { bannerUrl: w.bannerUrl, scoreEwma: w.scoreEwma }]));
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

  const onAddFriend = useCallback(async (agentId: string, _message?: string) => {
    if (agentLimitQuery.data && !agentLimitQuery.data.canAdd) {
      throw new Error(agentLimitQuery.data.reason || 'Agent friend limit reached');
    }
    await dataSync.requestOrAcceptFriend(agentId);
    setAddContactModalOpen(false);
    setSelectedAgentForAdd(null);
  }, [agentLimitQuery.data]);

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
      navigateToWorld(worldId);
    },
    [navigateToWorld],
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
    </>
  );
}
