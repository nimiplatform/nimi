import { useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../app-shell/providers/app-store';

import { ScrollArea } from '@nimiplatform/kit/ui';
import { createRendererFlowId, logRendererEvent } from '@nimiplatform/kit/telemetry';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';

import { WorldDetailPage } from './world-detail-template';
import type { WorldCharacter } from './world-detail-types';
import { useWorldPeopleCatalog } from './world-detail-people-catalog.js';
import type { WorldListItem } from './world-list-model';
import { fetchWorldPrimaryDisplayDetail, fetchWorldSupplementalDisplayDetail, toWorldPrimaryDisplayDetail, toWorldSupplementalDisplayDetail, type WorldDisplayDetail, toWorldDisplayFallback, WORLD_CATALOG_CONTRACT_VERSION, worldDisplayDetailQueryKey, worldPrimaryDisplayDetailQueryKey, worldSupplementalDisplayDetailQueryKey } from './world-detail-queries';
import { useFollowedWorlds } from './world-follow-store-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { createRealmWorldData } from './data/realm-world-data.js';
import type { WorldDetailInitialSubpage } from '../../app-shell/providers/store-types.js';

type WorldDetailProps = {
  world: WorldListItem;
  // The canonical world destination returns through Home navigation.
  onBack?: () => void;
  initialSubpage?: WorldDetailInitialSubpage | null;
};

export function WorldDetail({ world, onBack, initialSubpage }: WorldDetailProps) {

  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const bindings = useDesktopRendererBindings();
  const i18n = useDesktopI18nResource().instance;
  const queryClient = useQueryClient();
  const authStatus = useAppStore((state) => state.auth.status);

  const detailViewportRef = useRef<HTMLDivElement | null>(null);
  const readerOpenedHere = useRef(false);
  useEffect(() => { readerOpenedHere.current = false; }, [world.id]);
  const isReady = authStatus === 'authenticated' && !!world.id;
  const setFeedback = emitFeedbackToast;
  const flowIdRef = useRef('');
  const enteredAtRef = useRef(0);
  const primaryReadyLoggedRef = useRef(false);
  const historySemanticReadyLoggedRef = useRef(false);
  const extendedReadyLoggedRef = useRef(false);
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const cachedCompositeDisplay = isReady
    ? queryClient.getQueryData<WorldDisplayDetail>(worldDisplayDetailQueryKey(realmBaseUrl, world.id))
    : undefined;

  const worldPrimaryQuery = useQuery({
    queryKey: worldPrimaryDisplayDetailQueryKey(realmBaseUrl, world.id),
    queryFn: () => fetchWorldPrimaryDisplayDetail(
      world.id,
      createRealmWorldData(bindings.sdk),
    ),
    enabled: isReady,
    initialData: cachedCompositeDisplay ? () => toWorldPrimaryDisplayDetail(cachedCompositeDisplay) : undefined,
    staleTime: 30_000,
  });

  const primaryDisplay = worldPrimaryQuery.data;
  const worldSupplementalQuery = useQuery({
    queryKey: worldSupplementalDisplayDetailQueryKey(realmBaseUrl, world.id),
    queryFn: () => fetchWorldSupplementalDisplayDetail(
      world.id,
      createRealmWorldData(bindings.sdk),
    ),
    enabled: isReady && Boolean(primaryDisplay),
    initialData: cachedCompositeDisplay ? () => toWorldSupplementalDisplayDetail(cachedCompositeDisplay) : undefined,
    staleTime: 30_000,
  });

  const supplementalDisplay = worldSupplementalQuery.data;

  // The detail's first bounded page seeds the unfiltered people catalog.
  const realmWorldData = useMemo(() => createRealmWorldData(bindings.sdk), [bindings.sdk]);
  const [peopleQueryText, setPeopleQueryText] = useState(() => destination.id === 'world-detail' ? destination.search ?? '' : '');
  const peopleQuery = useDebouncedText(peopleQueryText);
  const primaryRecord = primaryDisplay?.primary;
  const seededCharacterPage = useMemo(() => {
    if (!primaryRecord) return undefined;
    const nextCursor = primaryRecord.charactersNextCursor;
    return {
      items: primaryRecord.characters.filter((character) => character.sourceKind !== 'personaCharacter'),
      nextCursor,
      hasMore: nextCursor !== null,
      totalCount: primaryRecord.characterCount,
    };
  }, [primaryRecord]);
  const seededPersonaPage = useMemo(() => {
    if (!primaryRecord) return undefined;
    const nextCursor = primaryRecord.personaCharactersNextCursor;
    return {
      items: primaryRecord.characters.filter((character) => character.sourceKind === 'personaCharacter'),
      nextCursor,
      hasMore: nextCursor !== null,
      totalCount: primaryRecord.personaCharacterCount,
    };
  }, [primaryRecord]);
  const offlineTier = useAppStore((state) => state.offlineTier);
  const worldTopicsQuery = useQuery({
    queryKey: ['world-topics', WORLD_CATALOG_CONTRACT_VERSION, realmBaseUrl],
    queryFn: () => realmWorldData.loadWorldTopics(),
    enabled: isReady && offlineTier === 'L0',
    staleTime: 60_000,
  });
  const { peopleCharacters, peopleCatalog } = useWorldPeopleCatalog({
    worldId: world.id,
    worldCreatedAt: world.createdAt,
    realmBaseUrl,
    query: peopleQuery,
    queryText: peopleQueryText,
    onQueryChange: setPeopleQueryText,
    seededCharacterPage,
    seededPersonaPage,
    enabled: isReady && Boolean(primaryRecord),
    networkOffline: offlineTier !== 'L0',
    source: realmWorldData,
  });
  const primaryLoading = worldPrimaryQuery.isPending && !primaryDisplay;
  const supplementalLoading = Boolean(primaryDisplay) && worldSupplementalQuery.isPending && !supplementalDisplay;
  const initialLoading = primaryLoading && !world.id;
  const initialError = !initialLoading
    && !primaryDisplay
    && worldPrimaryQuery.isError;
  const pageError = initialError;
  const worldData = primaryDisplay?.world ?? toWorldDisplayFallback(world);
  const characters: WorldCharacter[] = primaryDisplay?.characters ?? [];
  const safeHistory = supplementalDisplay?.history ?? { items: [], summary: null };
  const safeSemantic = supplementalDisplay?.semantic ?? {
    operationTitle: null,
    operationDescription: null,
    operationRules: [],
    powerSystems: [],
    standaloneLevels: [],
    taboos: [],
    topology: null,
    causality: null,
    languages: [],
    worldviewEvents: [],
    worldviewSnapshots: [],
    hasContent: false,
  };
  const safeAudits = supplementalDisplay?.audits ?? [];
  const safePublicAssets = supplementalDisplay?.publicAssets ?? {
    resourceRefs: [],
    externalRefs: [],
    intents: [],
    scenes: [],
  };

  useEffect(() => {
    if (!isReady) {
      return;
    }
    flowIdRef.current = createRendererFlowId('world-detail');
    enteredAtRef.current = performance.now();
    primaryReadyLoggedRef.current = false;
    historySemanticReadyLoggedRef.current = false;
    extendedReadyLoggedRef.current = false;
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'detail:entered',
      flowId: flowIdRef.current,
      details: {
        worldId: world.id,
        stage: 'entered',
      },
    });
  }, [isReady, world.id]);

  useEffect(() => {
    if (!worldPrimaryQuery.isSuccess || !primaryDisplay || primaryReadyLoggedRef.current) {
      return;
    }
    primaryReadyLoggedRef.current = true;
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'detail:primary-ready',
      flowId: flowIdRef.current,
      costMs: Number((performance.now() - enteredAtRef.current).toFixed(2)),
      details: {
        worldId: world.id,
        stage: 'primary',
      },
    });
  }, [primaryDisplay, world.id, worldPrimaryQuery.isSuccess]);

  useEffect(() => {
    if (!supplementalDisplay || !worldSupplementalQuery.isSuccess || historySemanticReadyLoggedRef.current) {
      return;
    }
    historySemanticReadyLoggedRef.current = true;
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'detail:history-semantic-settled',
      flowId: flowIdRef.current,
      costMs: Number((performance.now() - enteredAtRef.current).toFixed(2)),
      details: {
        worldId: world.id,
        stage: 'secondary',
        historyStatus: supplementalDisplay.sections.history,
        semanticStatus: supplementalDisplay.sections.semantic,
      },
    });
  }, [supplementalDisplay, world.id, worldSupplementalQuery.isSuccess]);

  useEffect(() => {
    if (!supplementalDisplay || !worldSupplementalQuery.isSuccess || extendedReadyLoggedRef.current) {
      return;
    }
    extendedReadyLoggedRef.current = true;
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'detail:assets-audits-settled',
      flowId: flowIdRef.current,
      costMs: Number((performance.now() - enteredAtRef.current).toFixed(2)),
      details: {
        worldId: world.id,
        stage: 'non-critical',
        auditStatus: supplementalDisplay.sections.audits,
        publicAssetsStatus: supplementalDisplay.sections.publicAssets,
      },
    });
  }, [supplementalDisplay, world.id, worldSupplementalQuery.isSuccess]);

  const handleViewCharacter = async (character: WorldCharacter) => {
    const position = navigation.getSnapshot().current.destination;
    // Save the originating catalog query before leaving so Back returns to it.
    if (position.id === 'world-detail' && position.worldId === world.id && position.search !== peopleQueryText) {
      const saved = await navigation.replace({ ...position, search: peopleQueryText });
      if (saved.status !== 'committed' && saved.status !== 'unchanged') return;
    }
    await navigation.push({ id: 'source-detail', sourceRef: character.sourceRef });
  };

  const followed = useFollowedWorlds();
  const worldFollowed = followed.isFollowed(world.id);
  const handleFollowWorld = () => {
    if (!followed.available) {
      setFeedback({ kind: 'error', message: i18n.t('World.atlas.followed.unavailable') });
      return;
    }
    try {
      followed.toggle(world.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : i18n.t('World.atlas.followed.error');
      setFeedback({ kind: 'error', message });
    }
  };

  return (
    <ScrollArea
      className="world-detail-surface h-full"
      viewportClassName="bg-transparent"
      viewportRef={detailViewportRef}
    >
      <WorldDetailPage
        world={worldData}
        characters={characters}
        peopleCharacters={peopleCharacters}
        peopleCatalog={peopleCatalog}
        history={safeHistory}
        semantic={safeSemantic}
        audits={safeAudits}
        publicAssets={safePublicAssets}
        topics={worldTopicsQuery.data ?? []}
        loading={initialLoading}
        error={pageError}
        charactersLoading={primaryLoading}
        historyLoading={supplementalLoading}
        semanticLoading={supplementalLoading}
        auditsLoading={false}
        publicAssetsLoading={supplementalLoading}
        readingIncomplete={worldSupplementalQuery.isError || supplementalDisplay?.sections.semantic === 'error' || supplementalDisplay?.sections.history === 'error'}
        publicAssetsIncomplete={worldSupplementalQuery.isError || supplementalDisplay?.sections.publicAssets === 'error'}
        onRetryReading={() => { void worldSupplementalQuery.refetch(); }}
        onBack={onBack}
        onReadWorld={() => {
          readerOpenedHere.current = true;
          void navigation.push({ id: 'world-detail', worldId: world.id, worldSubpage: 'reader', search: peopleQueryText });
        }}
        onBackToWorld={() => {
          if (readerOpenedHere.current && destination.worldSubpage === 'reader') void navigation.back();
          else void navigation.replace({ id: 'world-detail', worldId: world.id, search: peopleQueryText });
        }}
        onViewCharacter={handleViewCharacter}
        onFollowWorld={followed.available ? handleFollowWorld : undefined}
        worldFollowed={worldFollowed}
        initialSubpage={initialSubpage}
        rootScrollViewportRef={detailViewportRef}
      />
    </ScrollArea>
  );
}

const PEOPLE_SEARCH_DEBOUNCE_MS = 300;

function useDebouncedText(value: string): string {
  const normalized = value.trim();
  const [debounced, setDebounced] = useState(normalized);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(normalized), PEOPLE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [normalized]);
  return debounced;
}
