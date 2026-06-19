import { useEffect, useRef, useState } from 'react';
import { IconButton, ScrollArea, Surface } from '@nimiplatform/kit/ui';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { useTranslation } from 'react-i18next';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
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
  ExploreSectionHeader,
  type ExploreSectionId,
} from './explore-section-nav';

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
  fetchPostPage: (cursor: string | null) => Promise<{ items: PostDto[]; nextCursor: string | null }>;
  postFeedKey: string;
  onPostDelete?: () => void;
  loading: boolean;
  onToggleCategory: (category: string) => void;
  onPersonaSourceManage: (source: ExplorePersonaSourceCardData) => void;
  onPersonaSourceSendGift?: (sourceId: string) => void;
  onPersonaSourceOpen?: (sourceId: string) => void;
  onPostAuthorOpen?: (target: PostCardAuthorProfileTarget) => void;
  onWorldOpen?: (worldId: string) => void;
  onWorldSearchTextChange: (value: string) => void;
};

function ExploreSkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-3xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_86%,white)] ${className}`} />;
}

// RealmPersona section: a full browsable discovery grid across Worlds.
function ExplorePersonaSourcesSection({
  personaSources,
  onPersonaSourceManage,
  onPersonaSourceOpen,
}: {
  personaSources: ExplorePersonaSourceCardData[];
  onPersonaSourceManage: (source: ExplorePersonaSourceCardData) => void;
  onPersonaSourceOpen?: (sourceId: string) => void;
}) {
  const { t } = useTranslation();
  if (personaSources.length === 0) {
    return (
      <div
        className="rounded-[2rem] border border-dashed p-12 text-center"
        style={{
          borderColor: 'var(--nimi-border-subtle)',
          color: 'var(--nimi-fg-3)',
          fontSize: 13,
          fontFamily: 'var(--nimi-font-sans)',
        }}
        data-testid="explore-personas-empty"
      >
        {t('Explore.personaSourcesEmpty', { defaultValue: 'No personas match the current filters.' })}
      </div>
    );
  }
  return (
    <div
      className="grid items-stretch gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
      data-testid="explore-personas-grid"
    >
      {personaSources.map((personaSource) => (
        <PersonaSourceCard
          key={personaSource.id}
          source={personaSource}
          onPrimaryAction={() => onPersonaSourceManage(personaSource)}
          onOpen={() => onPersonaSourceOpen?.(personaSource.id)}
        />
      ))}
    </div>
  );
}

export function ExploreView(props: ExploreViewProps) {
  const { t } = useTranslation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const feedSectionRef = useRef<HTMLElement>(null);
  const postCardActionAdapter = usePostCardActionAdapter();
  const [feedColumns, setFeedColumns] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 640px)').matches
      ? 2
      : 1
  ));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(min-width: 640px)');
    const updateColumns = () => setFeedColumns(media.matches ? 2 : 1);
    updateColumns();
    media.addEventListener?.('change', updateColumns);
    return () => media.removeEventListener?.('change', updateColumns);
  }, []);

  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [props.activeSection]);

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (props.loading) {
    return (
      <div data-testid={E2E_IDS.panel('explore')} className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
        <ScrollArea className="flex-1" viewportClassName="bg-transparent" contentClassName="mx-auto w-full max-w-6xl space-y-10 px-1 py-5">
            <section className="space-y-3">
              <ExploreSkeletonBlock className="h-6 w-24 rounded-lg" />
              <ExploreSkeletonBlock className="h-[280px] w-full rounded-[2rem]" />
            </section>
            <section className="space-y-6">
              <ExploreSkeletonBlock className="h-7 w-36 rounded-lg" />
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Surface key={index} tone="card" elevation="base" className="rounded-[2rem] border-white/70 p-5">
                    <div className="flex items-center gap-3">
                      <ExploreSkeletonBlock className="h-10 w-10 rounded-full" />
                      <div className="space-y-2">
                        <ExploreSkeletonBlock className="h-4 w-24 rounded" />
                        <ExploreSkeletonBlock className="h-3 w-20 rounded" />
                      </div>
                    </div>
                    <ExploreSkeletonBlock className="mt-4 h-56 w-full rounded-[1.5rem]" />
                  </Surface>
                ))}
              </div>
            </section>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div data-testid={E2E_IDS.panel('explore')} className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
      {/* Scrollable section content */}
      <ScrollArea
        ref={scrollContainerRef}
        className="min-h-0 flex-1"
        viewportClassName="bg-transparent"
        contentClassName={props.activeSection === 'worlds'
          ? 'w-full px-1 py-5'
          : 'mx-auto w-full max-w-6xl px-1 py-5'}
        viewportRef={feedScrollRef}
      >
        {props.activeSection === 'worlds' && (
          <section data-testid="explore-worlds-section">
            {props.worldsLoading ? (
              <WorldsLoadingSkeleton embedded />
            ) : props.worldsError ? (
              <WorldsLoadError embedded />
            ) : (
              <WorldCatalogContent
                worlds={props.worldCatalogItems}
                onOpenWorld={(worldId) => props.onWorldOpen?.(worldId)}
                searchQuery={props.worldSearchText}
                onSearchQueryChange={props.onWorldSearchTextChange}
                embedded
              />
            )}
          </section>
        )}

        {props.activeSection === 'personas' && (
          <section data-testid="explore-personas-section">
            <ExploreSectionHeader section="personas" />
            <ExplorePersonaSourcesSection
              personaSources={props.personaSources}
              onPersonaSourceManage={props.onPersonaSourceManage}
              onPersonaSourceOpen={props.onPersonaSourceOpen}
            />
          </section>
        )}

        {props.activeSection === 'activity' && (
          <section ref={feedSectionRef} data-testid="explore-activity-section">
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

      <IconButton
        onClick={scrollToTop}
        tone="secondary"
        icon={(
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        )}
        className="fixed bottom-6 right-6 z-50 h-12 w-12 ring-1 ring-white/45 bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] text-[var(--nimi-text-secondary)] shadow-[0_18px_40px_rgba(15,23,42,0.12)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,white)] hover:text-[var(--nimi-text-primary)]"
        aria-label={t('Explore.backToTop', { defaultValue: 'Back to top' })}
        title={t('Explore.backToTop', { defaultValue: 'Back to top' })}
      />
    </div>
  );
}
