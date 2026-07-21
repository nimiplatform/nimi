import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useCallback, useMemo, useState } from 'react';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { realmExploreData } from './data/realm-explore-data';
import { useAppStore } from '../../app-shell/providers/app-store';
import type { WorldDetailNavigationOptions } from '../../app-shell/providers/store-types';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

import { InlineFeedback, type InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { ProfileDetailModal } from '../relationship/profile-detail-modal.js';
import { SendGiftModal } from '../economy/send-gift-modal';
import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import { ExploreView } from './explore-view';
import type { ExplorePersonaSourceCardData } from './explore-cards';
import type { ExploreSectionId } from './explore-section-nav';
import type { PostCardAuthorProfileTarget } from '../home/post-card';
import { parsePersonaSources, toProfileTargetFromPersonaSource } from './explore-persona-source-projection';
import {
  fetchWorldListItems,
  worldPrimaryDisplayDetailQueryKey,
  worldListQueryKey,
} from '../world/world-detail-queries.js';
import type { WorldCharacter } from '../world/world-detail-types.js';
import {
  characterSourceMaterializationFailureMessage,
  characterSourceRefKey,
  discoverCharacterSourceLocalAgents,
  resolveCharacterSourceState,
} from './character-source-materialization';
import { materializeSourceContactLaunchTarget } from '../relationship/source-contact-launch-target.js';
import { ensureRuntimeAgentExists } from '../chat/chat-agent-shell-host-actions-helpers';
import { launchAgentConversationFromDisplay } from '../chat/agent-conversation-launcher.js';
import { localAgentListQueryKey } from '../agents/local-agent-list-model';

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
  const i18n = useDesktopI18nResource().instance;
  const queryClient = useQueryClient();
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const navigateToSourceDetail = useAppStore((state) => state.navigateToSourceDetail);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProfileTarget, setSelectedProfileTarget] = useState<PostCardAuthorProfileTarget | null>(null);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);

  // Fetch worlds for banner carousel
  const worldsQuery = useQuery({
    queryKey: worldListQueryKey(),
    queryFn: async () => fetchWorldListItems(),
    enabled: bootstrapReady,
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
    enabled: bootstrapReady,
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
      personaSourceBase.map((source) => discoverCharacterSourceLocalAgents(source, ownerUserId)),
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
      const target = await materializeSourceContactLaunchTarget(source, ownerUserId, i18n.t);
      await ensureRuntimeAgentExists(target);
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
      setFeedback({
        kind: 'error',
        message: characterSourceMaterializationFailureMessage(error, i18n.t),
      });
    }
  }, [
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

  const onWorldOpen = useCallback(
    (worldId: string, options?: WorldDetailNavigationOptions) => {
      if (options) {
        navigateToWorld(worldId, options);
        return;
      }
      navigateToWorld(worldId);
    },
    [navigateToWorld],
  );

  const onWorldCharacterOpen = useCallback(
    (sourceRef: CharacterSourceRefV3) => {
      navigateToSourceDetail(sourceRef);
    },
    [navigateToSourceDetail],
  );

  const onWorldCharacterMaterialize = useCallback(async (character: WorldCharacter) => {
    try {
      const target = await materializeSourceContactLaunchTarget({
        ...character,
        isSource: true,
        displayName: character.name,
        sourceWorldId: character.sourceRef.worldId,
        sourceKind: character.sourceRef.kind,
        sourceId: character.sourceRef.id,
        sourceHash: character.sourceRef.sourceHash,
      }, ownerUserId, i18n.t);
      await ensureRuntimeAgentExists(target);
      await queryClient.invalidateQueries({
        queryKey: worldPrimaryDisplayDetailQueryKey(character.sourceRef.worldId),
        exact: true,
      });
      await queryClient.invalidateQueries({ queryKey: localAgentListQueryKey(ownerUserId), exact: true });
      setFeedback({
        kind: 'success',
        message: i18n.t('World.atlas.preview.people.materializedFeedback', {
          name: character.name,
          defaultValue: '{{name}} is now available as a local agent.',
        }),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: characterSourceMaterializationFailureMessage(error, i18n.t),
      });
    }
  }, [ownerUserId, queryClient]);

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
        onWorldCharacterOpen={onWorldCharacterOpen}
        onWorldCharacterMaterialize={onWorldCharacterMaterialize}
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
