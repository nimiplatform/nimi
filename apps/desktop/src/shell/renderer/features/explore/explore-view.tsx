import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState, InlineAlert, ScrollArea, Surface } from '@nimiplatform/kit/ui';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { useTranslation } from 'react-i18next';
import { E2E_IDS } from '../../testability/e2e-ids';
import { PostCard, type PostCardAuthorProfileTarget } from '../home/post-card';
import { usePostCardActionAdapter } from '../home/post-card-action-adapter';
import { PostFeed } from '../home/post-feed';
import {
  WorldCatalogContent,
  WorldsLoadError,
  WorldsLoadingSkeleton,
} from '../world/world-list';
import type { WorldListItem } from '../world/world-list-model';
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
import { PersonaCatalogContent } from './persona-catalog-content';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

type PostDto = RealmModel<'PostDto'>;

type ExploreViewProps = {
  selectedCategory: string | null;
  categories: string[];
  personaSources: ExplorePersonaSourceCardData[];
  worldCatalogItems: WorldListItem[];
  worldSearchText: string;
  worldsLoading: boolean;
  worldsError: boolean;
  activeSection: ExploreSectionId;
  onSectionChange: (section: ExploreSectionId) => void;
  onSearchTextChange: (value: string) => void;
  fetchPostPage: (cursor: string | null) => Promise<{ items: PostDto[]; nextCursor: string | null }>;
  postFeedKey: string;
  onPostDelete?: () => void;
  personaLoading: boolean;
  personaError: boolean;
  onRetryPersonas: () => void;
  onToggleCategory: (category: string) => void;
  onPersonaSourceManage: (source: ExplorePersonaSourceCardData) => void;
  onPersonaSourceSendGift?: (sourceId: string) => void;
  onPersonaSourceOpen?: (sourceRef: CharacterSourceRefV3) => void;
  onPostAuthorOpen?: (target: PostCardAuthorProfileTarget) => void;
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
  const bindings = useDesktopRendererBindings();
  const { t } = useTranslation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const feedSectionRef = useRef<HTMLElement>(null);
  const postCardActionAdapter = usePostCardActionAdapter();
  const [feedColumns, setFeedColumns] = useState(() => (
    bindings.app.projection.viewportWidth() >= 640 ? 2 : 1
  ));
  const [sourceRailMode, setSourceRailMode] = useState<ExploreSourceMode>('worlds');
  const sourceModeFlap = (
    <ExploreSourceModeFlap mode={sourceRailMode} onChange={setSourceRailMode} />
  );

  useEffect(() => {
    const updateColumns = () => setFeedColumns(
      bindings.app.projection.viewportWidth() >= 640 ? 2 : 1,
    );
    updateColumns();
    return bindings.app.events.subscribeWindowResize(updateColumns);
  }, [bindings]);

  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [props.activeSection]);

  const searchPlaceholder = t('Explore.searchPlaceholder', { defaultValue: 'Search personas by name/handle...' });
  const isWorldsSection = props.activeSection === 'worlds';
  // The worlds section owns a rail + detail layout with in-rail search, so the
  // shared section nav bar only renders for the personas/activity sections.
  const sectionHeader = isWorldsSection ? null : (
    <div className="shrink-0 pb-3">
      <div className="mx-auto w-full max-w-6xl">
        <ExploreSectionNav
          active={props.activeSection}
          onSelect={props.onSectionChange}
          trailing={(
            <ExploreSearchField
              value={props.worldSearchText}
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
            {t('Explore.personaSourcesLoadError', { defaultValue: 'Could not load personas.' })}
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
              searchQuery={props.worldSearchText}
              onSearchQueryChange={props.onSearchTextChange}
              loading={props.personaLoading}
              error={props.personaError}
              onRetry={props.onRetryPersonas}
              railFlap={sourceModeFlap}
              embedded
            />
          ) : props.worldsLoading ? (
            <WorldsLoadingSkeleton embedded />
          ) : props.worldsError ? (
            <WorldsLoadError embedded />
          ) : (
            <WorldCatalogContent
              worlds={props.worldCatalogItems}
              searchQuery={props.worldSearchText}
              onSearchQueryChange={props.onSearchTextChange}
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
          viewportRef={feedScrollRef}
        >
          {props.activeSection === 'personas' && (
            <section data-testid={E2E_IDS.exploreSection('personas')}>
              <ExploreSectionHeader section="personas" />
              <ExplorePersonaSourcesSection
                personaSources={props.personaSources}
                onPersonaSourceManage={props.onPersonaSourceManage}
                onPersonaSourceOpen={props.onPersonaSourceOpen}
              />
            </section>
          )}

          {props.activeSection === 'activity' && (
            <section ref={feedSectionRef} data-testid={E2E_IDS.exploreSection('activity')}>
              <ExploreSectionHeader section="activity" />
              <PostFeed
                key={props.postFeedKey}
                fetchPage={props.fetchPostPage}
                scrollRef={feedScrollRef}
                virtualOffsetRef={feedSectionRef}
                columns={feedColumns}
                emptyText={t('Explore.noPosts')}
                renderItem={(post) => (
                  <div className="h-fit [contain:paint] [transform:translateZ(0)]">
                    <PostCard
                      post={post}
                      actionAdapter={postCardActionAdapter}
                      onDelete={props.onPostDelete}
                      onOpenAuthorProfile={props.onPostAuthorOpen}
                    />
                  </div>
                )}
                className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2"
              />
            </section>
          )}
        </ScrollArea>
      )}
    </div>
  );
}
