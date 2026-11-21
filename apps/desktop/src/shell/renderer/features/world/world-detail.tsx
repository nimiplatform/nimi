import { useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../app-shell/providers/app-store';

import { ScrollArea } from '@nimiplatform/kit/ui';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';

import { WorldDetailPage } from './world-detail-template';
import type { WorldCharacter } from './world-detail-types';
import { useWorldPeopleCatalog } from './world-detail-people-catalog.js';
import { type WorldDisplayDetail, WORLD_CATALOG_CONTRACT_VERSION } from './world-detail-queries';
import { useFollowedWorlds } from './world-follow-store-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { createRealmWorldData } from './data/realm-world-data.js';
import type { WorldDetailInitialSubpage } from '../../app-shell/providers/store-types.js';

type WorldDetailProps = {
  detail: WorldDisplayDetail;
  onRetry: () => void;
  // The canonical world destination returns through Home navigation.
  onBack?: () => void;
  initialSubpage?: WorldDetailInitialSubpage | null;
};

export function WorldDetail({ detail, onRetry, onBack, initialSubpage }: WorldDetailProps) {

  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const bindings = useDesktopRendererBindings();
  const i18n = useDesktopI18nResource().instance;
  const { world, primary: primaryRecord } = detail;
  const authStatus = useAppStore((state) => state.auth.status);

  const detailViewportRef = useRef<HTMLDivElement | null>(null);
  const isReady = authStatus === 'authenticated' && !!world.id;
  const setFeedback = emitFeedbackToast;
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  // The detail's first bounded page seeds the unfiltered people catalog.
  const realmWorldData = useMemo(() => createRealmWorldData(bindings.sdk), [bindings.sdk]);
  const [peopleQueryText, setPeopleQueryText] = useState(() => destination.id === 'world-detail' ? destination.search ?? '' : '');
  const peopleQuery = useDebouncedText(peopleQueryText);
  const seededCharacterPage = useMemo(() => {
    const nextCursor = primaryRecord.charactersNextCursor;
    return {
      items: primaryRecord.characters.filter((character) => character.sourceKind !== 'personaCharacter'),
      nextCursor,
      hasMore: nextCursor !== null,
      totalCount: primaryRecord.characterCount,
    };
  }, [primaryRecord]);
  const seededPersonaPage = useMemo(() => {
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
    enabled: isReady,
    networkOffline: offlineTier !== 'L0',
    source: realmWorldData,
  });
  const savePeopleQuery = async () => {
    const position = navigation.getSnapshot().current.destination;
    if (position.id !== 'world-detail' || position.worldId !== world.id) return false;
    if ((position.search ?? '') === peopleQueryText) return true;
    const saved = await navigation.replace({ ...position, search: peopleQueryText });
    return saved.status === 'committed' || saved.status === 'unchanged';
  };
  const handleViewCharacter = async (character: WorldCharacter) => {
    if (!await savePeopleQuery()) return;
    await navigation.push({ id: 'source-detail', sourceRef: character.sourceRef });
  };
  const openSubpage = async (worldSubpage: WorldDetailInitialSubpage) => {
    if (!await savePeopleQuery()) return;
    await navigation.push({ id: 'world-detail', worldId: world.id, worldSubpage, search: peopleQueryText });
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
        world={world}
        characters={detail.characters}
        peopleCharacters={peopleCharacters}
        peopleCatalog={peopleCatalog}
        history={detail.history}
        semantic={detail.semantic}
        audits={detail.audits}
        publicAssets={detail.publicAssets}
        topics={worldTopicsQuery.data ?? []}
        loading={false}
        error={false}
        readingIncomplete={detail.sections.semantic === 'error' || detail.sections.history === 'error'}
        publicAssetsIncomplete={detail.sections.publicAssets === 'error'}
        onRetryReading={onRetry}
        onBack={onBack}
        onReadWorld={() => { void openSubpage('reader'); }}
        onOpenRelationships={() => { void openSubpage('relationship-explorer'); }}
        onBackToWorld={() => {
          if (destination.worldSubpage && navigation.getSnapshot().canGoBack) void navigation.back();
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
