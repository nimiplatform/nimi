import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ExploreView } from './explore-view';
import type { ExploreAgentCardData, FeaturedWorldCardData } from './explore-cards';

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

function mapAgent(raw: unknown): ExploreAgentCardData | null {
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

  return {
    id,
    name: displayName,
    handle,
    avatarUrl: asString(source.avatarUrl).trim() || null,
    description: category ? `${category} agent` : 'Public agent',
    tags,
    badgeText: origin ? `Origin: ${origin}` : 'Community',
    worldId,
  };
}

function parseAgents(agentsResult: unknown): ExploreAgentCardData[] {
  const payload = toRecord(agentsResult);
  const raw = Array.isArray(payload?.items) ? payload.items : [];
  return raw
    .map((item) => mapAgent(item))
    .filter((item): item is ExploreAgentCardData => item !== null);
}

export function ExplorePanel() {
  const authStatus = useAppStore((state) => state.auth.status);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

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
      return parseAgents(result);
    },
    enabled: authStatus === 'authenticated',
  });

  const agents = agentsQuery.data ?? [];

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

  // Reset PostFeed when category changes
  const postFeedKey = `explore-${selectedCategory ?? 'all'}`;

  const onAgentChat = useCallback(
    (agentId: string) => {
      const target = agents.find((item) => item.id === agentId);
      setRuntimeFields({
        targetType: 'AGENT',
        targetAccountId: '',
        agentId,
        worldId: target?.worldId || '',
      });
      setActiveTab('mod:local-chat');
    },
    [agents, setActiveTab, setRuntimeFields],
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

  return (
    <ExploreView
      searchText={searchText}
      selectedCategory={selectedCategory}
      categories={categories}
      featuredWorlds={DEFAULT_FEATURED_WORLDS}
      topAgents={topAgents}
      fetchPostPage={fetchPostPage}
      postFeedKey={postFeedKey}
      loading={agentsQuery.isPending}
      onSearchTextChange={setSearchText}
      onToggleCategory={onToggleCategory}
      onAgentChat={onAgentChat}
    />
  );
}
