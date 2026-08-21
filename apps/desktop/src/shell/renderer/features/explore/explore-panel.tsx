import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useCallback, useMemo, useState } from 'react';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRealmExploreData } from './data/realm-explore-data';
import { createRealmWorldData } from '../world/data/realm-world-data.js';
import { useAppStore } from '../../app-shell/providers/app-store';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import { ProfileDetailModal } from '../relationship/profile-detail-modal.js';
import { SendGiftModal } from '../economy/send-gift-modal';
import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import { ExploreView } from './explore-view';
import type { ExplorePersonaSourceCardData } from './explore-cards';
import type { ExploreSectionId } from './explore-section-nav';
import type { PostCardAuthorProfileTarget } from '../home/post-card';
import { parsePersonaSources } from './explore-persona-source-projection';
import {
  fetchWorldListItems,
  worldListQueryKey,
} from '../world/world-detail-queries.js';
import {
  characterSourceMaterializationFailureMessage,
  characterSourceRefKey,
  discoverCharacterSourceLocalAgents,
  resolveCharacterSourceState,
} from './character-source-materialization';
import { materializeCharacterSourceLaunchTarget } from '../relationship/character-source-launch-target.js';
import { ensureRuntimeAgentExists } from '../chat/chat-agent-shell-host-actions-helpers';
import { launchAgentConversationFromDisplay } from '../chat/agent-conversation-launcher.js';
import { localAgentListQueryKey } from '../agents/local-agent-list-model';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

type PostDto = RealmModel<'PostDto'>;

const PAGE_SIZE = 20;
const DEFAULT_CATEGORIES = ['Research', 'Coding', 'Writing', 'Analysis', 'Creative', 'Education', 'Health & Finance'];

function toRecord(value: unknown): JsonObject | null {
  return parseOptionalJsonObject(value) ?? null;
}

type ExplorePanelProps = {
  activeSection: ExploreSectionId;
  searchText: string;
  onSectionChange: (section: ExploreSectionId) => void;
  onSearchTextChange: (value: string) => void;
};

// @nimi-authority: definition.nimi.desktop.product-surfaces.explore
// @nimi-authority: rule.nimi.desktop.product-surfaces.r001
export function ExplorePanel(props: ExplorePanelProps) {
  const bindings = useDesktopRendererBindings();
  const realmExploreData = useMemo(
    () => createRealmExploreData(bindings.sdk),
    [bindings.sdk],
  );
  const i18n = useDesktopI18nResource().instance;
  const queryClient = useQueryClient();
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const navigateToSourceDetail = useAppStore((state) => state.navigateToSourceDetail);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProfileTarget, setSelectedProfileTarget] = useState<
    Extract<PostCardAuthorProfileTarget, { kind: 'human' }> | null
  >(null);
  const setFeedback = emitFeedbackToast;

  // Fetch worlds for banner carousel
  const worldsQuery = useQuery({
    queryKey: worldListQueryKey(),
    queryFn: async () => fetchWorldListItems(createRealmWorldData(bindings.sdk)),
    enabled: bootstrapReady,
    staleTime: 30_000,
  });

  // Create worlds map for personaSource mapping
  const worldsMap = useMemo(() => {
    const worlds = worldsQuery.data ?? [];
    return new Map(worlds.map((w) => [w.id, { bannerUrl: w.bannerUrl, name: w.name }]));
  }, [worldsQuery.data]);

  // Fetch personaSources for sidebar
  const personaSourcesQuery = useQuery({
    queryKey: ['explore-personas', authStatus, selectedCategory, props.searchText],
    queryFn: async () => {
      const tag = selectedCategory || undefined;
      const query = props.searchText.trim() || undefined;
      return realmExploreData.loadExplorePersonas({ tag, query, limit: PAGE_SIZE });
    },
    enabled: bootstrapReady,
    placeholderData: (previousData) => previousData,
  });

  const personaSourceBase = useMemo(
    () => parsePersonaSources(personaSourcesQuery.data, worldsMap),
    [personaSourcesQuery.data, worldsMap],
  );

  const personaSourceDiscoveryKey = useMemo(
    () => personaSourceBase
      .map((source) => source.sourceRef ? characterSourceRefKey(source.sourceRef) : source.id)
      .join('|'),
    [personaSourceBase],
  );

  const personaSourceLocalAgentsQuery = useQuery({
    queryKey: ['explore-personas-local-agents', ownerUserId, personaSourceDiscoveryKey],
    queryFn: async () => (await Promise.all(
      personaSourceBase.map((source) => discoverCharacterSourceLocalAgents(source, ownerUserId, bindings.sdk)),
    )).flat(),
    enabled: authStatus === 'authenticated' && Boolean(ownerUserId) && personaSourceBase.length > 0,
    staleTime: 10_000,
  });

  const personaSourceRuntimeInventoryPending = Boolean(
    ownerUserId
    && personaSourceBase.length > 0
    && personaSourceLocalAgentsQuery.isPending,
  );
  const personaSourceRuntimeInventoryUnavailable = Boolean(
    personaSourceBase.length > 0
    && (!ownerUserId || personaSourceLocalAgentsQuery.isError),
  );

  const personaSources = useMemo(
    () => personaSourceBase.map((personaSource) => ({
      ...personaSource,
      sourceState: resolveCharacterSourceState(
        personaSource,
        personaSourceLocalAgentsQuery.data ?? [],
        {
          runtimeInventoryPending: personaSourceRuntimeInventoryPending,
          runtimeInventoryUnavailable: personaSourceRuntimeInventoryUnavailable,
        },
      ),
    })),
    [
      personaSourceBase,
      personaSourceLocalAgentsQuery.data,
      personaSourceRuntimeInventoryPending,
      personaSourceRuntimeInventoryUnavailable,
    ],
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

  // fetchPostPage for PostFeed --PostFeed manages its own pagination internally
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
      const target = await materializeCharacterSourceLaunchTarget({
        ...source,
        runtimeSourceRef: source.viewerRelation.runtimeSourceRef,
      }, ownerUserId, i18n.t, bindings.sdk);
      await ensureRuntimeAgentExists(target, bindings.sdk, ownerUserId);
      await queryClient.invalidateQueries({ queryKey: ['explore-personas-local-agents'], exact: false });
      await queryClient.invalidateQueries({ queryKey: localAgentListQueryKey(ownerUserId), exact: true });
      await launchAgentConversationFromDisplay({
        target,
        setActiveTab,
        setChatMode,
        setSelectedTargetForSource,
        setAgentConversationSelection,
        setAgentConversationTargetSnapshot,
      });
      setFeedback({
        kind: 'success',
        message: i18n.t('Explore.characterSourceMaterializedFeedback', {
          defaultValue: 'Your partner is ready. Opening chat.',
        }),
      });
      logRendererEvent({
        level: 'info',
        area: 'explore',
        message: 'action:realm-source-materialization:partner-opened',
      });
    } catch (error) {
      // eslint-disable-next-line no-console -- temporary debug instrumentation
      console.error('[nimi-debug-open-partner]', error, (error as { cause?: unknown })?.cause, JSON.stringify({
        message: (error as Error)?.message,
        reasonCode: (error as { reasonCode?: string })?.reasonCode,
        actionHint: (error as { actionHint?: string })?.actionHint,
        causeMessage: ((error as { cause?: Error })?.cause)?.message,
      }));
      setFeedback({
        kind: 'error',
        message: characterSourceMaterializationFailureMessage(error, i18n.t),
      });
    }
  }, [
    bindings,
    ownerUserId,
    queryClient,
    setActiveTab,
    setAgentConversationSelection,
    setAgentConversationTargetSnapshot,
    setChatMode,
    setSelectedTargetForSource,
  ]);

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

  const onPostAuthorOpen = useCallback(
    (target: PostCardAuthorProfileTarget) => {
      if (target.kind === 'character') {
        navigateToSourceDetail(target.sourceRef);
        return;
      }
      setSelectedProfileTarget(target);
    },
    [navigateToSourceDetail],
  );

  const onPersonaSourceOpen = useCallback(
    (sourceRef: CharacterSourceRefV3) => {
      navigateToSourceDetail(sourceRef);
    },
    [navigateToSourceDetail],
  );

  return (
    <>
      <ExploreView
        selectedCategory={selectedCategory}
        categories={categories}
        personaSources={personaSources}
        worldCatalogItems={worldsQuery.data ?? []}
        worldSearchText={props.searchText}
        worldsLoading={worldsQuery.isPending}
        worldsError={worldsQuery.isError}
        activeSection={props.activeSection}
        onSectionChange={props.onSectionChange}
        onSearchTextChange={props.onSearchTextChange}
        fetchPostPage={fetchPostPage}
        postFeedKey={postFeedKey}
        onPostDelete={() => setRefreshKey((k) => k + 1)}
        personaLoading={personaSourcesQuery.isPending}
        personaError={personaSourcesQuery.isError}
        onRetryPersonas={() => {
          void personaSourcesQuery.refetch();
        }}
        onToggleCategory={onToggleCategory}
        onPersonaSourceManage={onPersonaSourceManage}
        onPersonaSourceSendGift={onPersonaSourceSendGift}
        onPersonaSourceOpen={onPersonaSourceOpen}
        onPostAuthorOpen={onPostAuthorOpen}
      />
      <SendGiftModal
        open={giftModalOpen}
        receiverId={selectedSourceForGift?.id || ''}
        receiverName={selectedSourceForGift?.name || 'Persona'}
        receiverHandle={selectedSourceForGift?.handle}
        receiverIsSource
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
