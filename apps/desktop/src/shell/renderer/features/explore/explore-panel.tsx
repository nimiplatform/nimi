import { useCallback, useMemo, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { useQuery } from '@tanstack/react-query';
import { realmExploreData } from './data/realm-explore-data';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { i18n } from '@renderer/i18n';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { ProfileDetailModal } from '@renderer/features/relationship/profile-detail-modal.js';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import { ExploreView } from './explore-view';
import type { ExplorePersonaSourceCardData } from './explore-cards';
import type { ExploreSectionId } from './explore-section-nav';
import type { PostCardAuthorProfileTarget } from '../home/post-card';
import { parsePersonaSources, toProfileTargetFromPersonaSource } from './explore-persona-source-projection';
import {
  fetchWorldListItems,
  prefetchWorldDetailAndHistory,
  worldListQueryKey,
} from '../world/world-detail-queries.js';
import { prefetchWorldDetailPanel } from '../world/world-detail-route-state';
import {
  realmPersonaSourceMaterializationMessage,
  resolveRealmPersonaSourceState,
} from './realm-persona-source-materialization';
import { materializeSourceContactLaunchTarget } from '@renderer/features/relationship/source-contact-launch-target.js';
import { ensureRuntimeAgentExists } from '@renderer/features/chat/chat-agent-shell-host-actions-helpers';

type PostDto = RealmModel<'PostDto'>;

const PAGE_SIZE = 20;
const DEFAULT_CATEGORIES = ['Research', 'Coding', 'Writing', 'Analysis', 'Creative', 'Education', 'Health & Finance'];

function toRecord(value: unknown): JsonObject | null {
  return parseOptionalJsonObject(value) ?? null;
}

type ExplorePanelProps = {
  activeSection: ExploreSectionId;
  searchText: string;
  onSearchTextChange: (value: string) => void;
};

export function ExplorePanel(props: ExplorePanelProps) {
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProfileTarget, setSelectedProfileTarget] = useState<PostCardAuthorProfileTarget | null>(null);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);

  // Fetch worlds for banner carousel
  const worldsQuery = useQuery({
    queryKey: worldListQueryKey(),
    queryFn: async () => fetchWorldListItems(),
    staleTime: 30_000,
  });

  // Create worlds map for personaSource mapping
  const worldsMap = useMemo(() => {
    const worlds = worldsQuery.data ?? [];
    return new Map(worlds.map((w) => [w.id, { bannerUrl: w.bannerUrl, scoreEwma: w.scoreEwma, name: w.name }]));
  }, [worldsQuery.data]);

  // Fetch personaSources for sidebar
  const personaSourcesQuery = useQuery({
    queryKey: ['explore-personas', authStatus, selectedCategory, props.searchText],
    queryFn: async () => {
      const tag = selectedCategory || undefined;
      const query = props.searchText.trim() || undefined;
      return realmExploreData.loadExplorePersonas({ tag, query, limit: PAGE_SIZE });
    },
    enabled: authStatus === 'authenticated',
  });

  const personaSources = useMemo(
    () => {
      const mapped = parsePersonaSources(personaSourcesQuery.data, worldsMap);
      return mapped.map((personaSource) => ({
        ...personaSource,
        sourceState: resolveRealmPersonaSourceState(personaSource),
      }));
    },
    [personaSourcesQuery.data, worldsMap],
  );

  const categories = useMemo(() => {
    const dynamicTags = new Set<string>();
    for (const personaSource of personaSources) {
      for (const tag of personaSource.tags) {
        const normalized = tag.trim();
        if (normalized) {
          dynamicTags.add(normalized);
        }
      }
    }
    const combined = [...DEFAULT_CATEGORIES, ...Array.from(dynamicTags)];
    return Array.from(new Set(combined)).slice(0, 16);
  }, [personaSources]);

  // fetchPostPage for PostFeed â€?PostFeed manages its own pagination internally
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

  // Send Gift Modal state
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [selectedSourceForGift, setSelectedSourceForGift] = useState<ExplorePersonaSourceCardData | null>(null);

  const onPersonaSourceManage = useCallback(async (source: ExplorePersonaSourceCardData) => {
    try {
      const target = await materializeSourceContactLaunchTarget(source, ownerUserId);
      await ensureRuntimeAgentExists(target);
      setFeedback({
        kind: 'success',
        message: i18n.t('Explore.realmPersonaSourceMaterializedFeedback', {
          defaultValue: 'Local agent created on this device.',
        }),
      });
      logRendererEvent({
        level: 'info',
        area: 'explore',
        message: 'action:realm-source-materialization:local-agent-created',
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : realmPersonaSourceMaterializationMessage(),
      });
    }
  }, [ownerUserId]);

  const onPersonaSourceSendGift = useCallback(
    (sourceId: string) => {
      const target = personaSources.find((item) => item.id === sourceId);
      if (target) {
        setSelectedSourceForGift(target);
        setGiftModalOpen(true);
      }
    },
    [personaSources],
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

  const onPersonaSourceOpen = useCallback(
    (sourceId: string) => {
      const target = personaSources.find((item) => item.id === sourceId) || null;
      if (!target) {
        return;
      }
      setSelectedProfileTarget(toProfileTargetFromPersonaSource(target));
    },
    [personaSources],
  );

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
        personaSources={personaSources}
        worldCatalogItems={worldsQuery.data ?? []}
        worldSearchText={props.searchText}
        worldsLoading={worldsQuery.isPending}
        worldsError={worldsQuery.isError}
        activeSection={props.activeSection}
        fetchPostPage={fetchPostPage}
        postFeedKey={postFeedKey}
        onPostDelete={() => setRefreshKey((k) => k + 1)}
        loading={personaSourcesQuery.isPending}
        onToggleCategory={onToggleCategory}
        onPersonaSourceManage={onPersonaSourceManage}
        onPersonaSourceSendGift={onPersonaSourceSendGift}
        onPersonaSourceOpen={onPersonaSourceOpen}
        onPostAuthorOpen={setSelectedProfileTarget}
        onWorldOpen={onWorldOpen}
        onWorldSearchTextChange={props.onSearchTextChange}
      />
      <SendGiftModal
        open={giftModalOpen}
        receiverId={selectedSourceForGift?.id || ''}
        receiverName={selectedSourceForGift?.name || 'Persona'}
        receiverHandle={selectedSourceForGift?.handle}
        receiverIsSource={selectedSourceForGift?.isSource === true}
        receiverAvatarUrl={selectedSourceForGift?.avatarUrl}
        onClose={() => {
          setGiftModalOpen(false);
          setSelectedSourceForGift(null);
        }}
        onSent={() => {
          setGiftModalOpen(false);
          setSelectedSourceForGift(null);
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
