import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, EmptyState, InlineAlert, ScrollArea, Surface } from '@nimiplatform/kit/ui';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';
import { useTranslation } from 'react-i18next';
import { E2E_IDS } from '../../testability/e2e-ids';
import {
  WorldCatalogContent,
  type WorldCatalogPaging,
} from '../world/world-list';
import type { WorldListItem } from '../world/world-list-model';
import type { WorldAtlasTopic, WorldPeopleRenderer } from '../world/world-atlas.js';
import {
  PersonaSourceCard,
  type ExplorePersonaSourceCardData,
} from './explore-cards';
import {
  ExploreSearchField,
  ExploreSectionHeader,
  ExploreSectionNav,
  type ExploreSectionId,
} from './explore-section-nav';
import { ExploreSourceModeFlap, type ExploreSourceMode } from './explore-source-mode-flap';
import { PersonaCatalogContent, PersonaCatalogMore } from './persona-catalog-content';


type ExploreViewProps = {
  personaSources: ExplorePersonaSourceCardData[];
  worldCatalogItems: WorldListItem[];
  worldCatalogPaging: WorldCatalogPaging;
  worldFavorites?: boolean;
  onWorldFavoritesSelect?: () => void;
  worldFavoritesUnavailable?: string;
  worldFavoritesPartialError?: boolean;
  worldTopics?: readonly WorldAtlasTopic[];
  worldTopicShelves?: ReactNode;
  renderWorldPeople?: WorldPeopleRenderer;
  worldTopicId?: string;
  onWorldTopicChange?: (value: string) => void;
  worldTopicsFailed?: boolean;
  onRetryWorldTopics?: () => void;
  worldSearchText: string;
  onWorldSearchTextChange: (value: string) => void;
  personaSearchText: string;
  personaTotalCount: number;
  personaHasMore: boolean;
  personaLoadingMore: boolean;
  personaLoadMoreFailed: boolean;
  personaOffline: boolean;
  onLoadMorePersonas: () => void;
  worldsLoading: boolean;
  worldsError: boolean;
  worldsOffline: boolean;
  onRetryWorlds: () => void;
  activeSection: ExploreSectionId;
  onSectionChange: (section: ExploreSectionId) => void;
  onSearchTextChange: (value: string) => void;
  personaLoading: boolean;
  personaError: boolean;
  onRetryPersonas: () => void;
  onPersonaSourceManage: (source: ExplorePersonaSourceCardData) => void;
  onPersonaSourceOpen?: (sourceRef: CharacterSourceRefV3) => void;
};

function ExploreSkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-3xl bg-[var(--nimi-surface-active)] ${className}`} />;
}

// PersonaCharacter section: a full browsable discovery grid across Worlds.
function ExplorePersonaSourcesSection({
  personaSources,
  onPersonaSourceManage,
  onPersonaSourceOpen,
}: {
  personaSources: ExplorePersonaSourceCardData[];
  onPersonaSourceManage: (source: ExplorePersonaSourceCardData) => void;
  onPersonaSourceOpen?: (sourceRef: CharacterSourceRefV3) => void;
}) {
  const { t } = useTranslation();
  if (personaSources.length === 0) {
    return (
      <EmptyState
        data-testid="explore-personas-empty"
        title={t('Explore.personaSourcesEmpty', { defaultValue: 'No personas match the current filters.' })}
      />
    );
  }
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] items-stretch gap-4"
      data-testid="explore-personas-grid"
    >
      {personaSources.map((personaSource) => (
        <PersonaSourceCard
          key={personaSource.id}
          source={personaSource}
          onPrimaryAction={() => onPersonaSourceManage(personaSource)}
          onOpen={() => onPersonaSourceOpen?.(personaSource.sourceRef)}
        />
      ))}
    </div>
  );
}

export function ExploreView(props: ExploreViewProps) {
  const { t } = useTranslation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const catalogScrollRef = useRef<HTMLDivElement>(null);
  const [sourceRailMode, setSourceRailMode] = useState<ExploreSourceMode>('worlds');
  const sourceModeFlap = (
    <ExploreSourceModeFlap mode={sourceRailMode} onChange={setSourceRailMode} />
  );

  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [props.activeSection]);

  const searchPlaceholder = t('Explore.searchPlaceholder', { defaultValue: 'Search personas by name/handle...' });
  const isWorldsSection = props.activeSection === 'worlds';
  // The worlds section owns a rail + detail layout with in-rail search, so the
  // shared section nav bar only renders for the personas section.
  const sectionHeader = isWorldsSection ? null : (
    <div className="shrink-0 pb-3">
      <div className="mx-auto w-full max-w-6xl">
        <ExploreSectionNav
          active={props.activeSection}
          onSelect={props.onSectionChange}
          trailing={(
            <ExploreSearchField
              value={props.personaSearchText}
              onChange={props.onSearchTextChange}
              placeholder={searchPlaceholder}
            />
          )}
        />
      </div>
    </div>
  );

  if (props.personaLoading && props.activeSection === 'personas') {
    return (
      <div data-testid={E2E_IDS.panel('explore')} className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
        {sectionHeader}
        <span className="sr-only" role="status" aria-live="polite">
          {t('Common.loading', { defaultValue: 'Loading…' })}
        </span>
        <ScrollArea className="flex-1" viewportClassName="bg-transparent" contentClassName="mx-auto w-full max-w-6xl space-y-10 px-1 py-5">
            <section className="space-y-3">
              <ExploreSkeletonBlock className="h-6 w-24 rounded-lg" />
              <ExploreSkeletonBlock className="h-[280px] w-full rounded-[var(--nimi-radius-xl)]" />
            </section>
            <section className="space-y-6">
              <ExploreSkeletonBlock className="h-7 w-36 rounded-lg" />
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Surface key={index} tone="card" elevation="base" className="rounded-[var(--nimi-radius-xl)] border-[var(--nimi-border-subtle)] p-5">
                    <div className="flex items-center gap-3">
                      <ExploreSkeletonBlock className="h-10 w-10 rounded-full" />
                      <div className="space-y-2">
                        <ExploreSkeletonBlock className="h-4 w-24 rounded" />
                        <ExploreSkeletonBlock className="h-3 w-20 rounded" />
                      </div>
                    </div>
                    <ExploreSkeletonBlock className="mt-4 h-56 w-full rounded-[var(--nimi-radius-xl)]" />
                  </Surface>
                ))}
              </div>
            </section>
        </ScrollArea>
      </div>
    );
  }

  if (props.personaError && props.activeSection === 'personas') {
    return (
      <div data-testid={E2E_IDS.panel('explore')} className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
        {sectionHeader}
        <div className="mx-auto w-full max-w-6xl py-5">
          <InlineAlert
            tone="danger"
            action={(
              <Button type="button" tone="secondary" size="sm" onClick={props.onRetryPersonas}>
                {t('Explore.retryPersonas', { defaultValue: 'Retry' })}
              </Button>
            )}
          >
            {t(props.personaOffline ? 'Explore.personaSourcesOffline' : 'Explore.personaSourcesLoadError')}
          </InlineAlert>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={E2E_IDS.panel('explore')}
      className={isWorldsSection
        ? 'flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2'
        : 'flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4'}
    >
      {sectionHeader}
      {isWorldsSection ? (
        /* Worlds owns its full-height rail + detail layout and scrolls internally. */
        <section data-testid={E2E_IDS.exploreSection('worlds')} className="flex min-h-0 flex-1 flex-col">
          {sourceRailMode === 'personas' ? (
            <PersonaCatalogContent
              personas={props.personaSources}
              totalCount={props.personaTotalCount}
              hasMore={props.personaHasMore}
              loadingMore={props.personaLoadingMore}
              loadMoreFailed={props.personaLoadMoreFailed}
              offline={props.personaOffline}
              onLoadMore={props.onLoadMorePersonas}
              searchQuery={props.personaSearchText}
              onSearchQueryChange={props.onSearchTextChange}
              loading={props.personaLoading}
              error={props.personaError}
              onRetry={props.onRetryPersonas}
              railFlap={sourceModeFlap}
              embedded
            />
          ) : (
            <WorldCatalogContent
              favorites={props.worldFavorites}
              onFavoritesSelect={props.onWorldFavoritesSelect}
              favoritesUnavailable={props.worldFavoritesUnavailable}
              favoritesPartialError={props.worldFavoritesPartialError}
              loading={props.worldsLoading}
              error={props.worldsError}
              offline={props.worldsOffline}
              onRetry={props.onRetryWorlds}
              topicShelves={props.worldTopicShelves}
              renderPeople={props.renderWorldPeople}
              worlds={props.worldCatalogItems}
              paging={props.worldCatalogPaging}
              topics={props.worldTopics}
              topicId={props.worldTopicId}
              onTopicChange={props.onWorldTopicChange}
              topicsFailed={props.worldTopicsFailed}
              onRetryTopics={props.onRetryWorldTopics}
              searchQuery={props.worldSearchText}
              onSearchQueryChange={props.onWorldSearchTextChange}
              railFlap={sourceModeFlap}
              embedded
            />
          )}
        </section>
      ) : (
        /* Scrollable section content */
        <ScrollArea
          ref={scrollContainerRef}
          className="min-h-0 flex-1"
          viewportClassName="bg-transparent"
          contentClassName="mx-auto w-full max-w-6xl px-1 py-5"
          viewportRef={catalogScrollRef}
        >
          {props.activeSection === 'personas' && (
            <section data-testid={E2E_IDS.exploreSection('personas')}>
              <ExploreSectionHeader section="personas" />
              <ExplorePersonaSourcesSection
                personaSources={props.personaSources}
                onPersonaSourceManage={props.onPersonaSourceManage}
                onPersonaSourceOpen={props.onPersonaSourceOpen}
              />
              <PersonaCatalogMore
                hasMore={props.personaHasMore}
                loadingMore={props.personaLoadingMore}
                loadMoreFailed={props.personaLoadMoreFailed}
                offline={props.personaOffline}
                onLoadMore={props.onLoadMorePersonas}
              />
            </section>
          )}

        </ScrollArea>
      )}
    </div>
  );
}
