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
  AgentRecommendationCard,
  type ExploreAgentCardData,
} from './explore-cards';
import {
  ExploreSectionHeader,
  type ExploreSectionId,
} from './explore-section-nav';

type PostDto = RealmModel<'PostDto'>;

type WorldBanner = {
  id: string;
  name: string;
  bannerUrl: string | null;
  type: string;
  tagline: string | null;
  eraLabel: string | null;
  currentLabel: string | null;
  flowRatio: number | null;
  agentCount: number | null;
};

type ExploreViewProps = {
  selectedCategory: string | null;
  categories: string[];
  agents: ExploreAgentCardData[];
  worldBanners: WorldBanner[];
  worldCatalogItems: WorldListItem[];
  worldsLoading: boolean;
  worldsError: boolean;
  activeSection: ExploreSectionId;
  fetchPostPage: (cursor: string | null) => Promise<{ items: PostDto[]; nextCursor: string | null }>;
  postFeedKey: string;
  onPostDelete?: () => void;
  loading: boolean;
  onToggleCategory: (category: string) => void;
  onAgentAddFriend: (agentId: string) => void;
  onAgentOpenChat: (agentId: string) => void;
  onAgentManageFriends: () => void;
  onAgentSendGift?: (agentId: string) => void;
  onAgentOpen?: (agentId: string) => void;
  onPostAuthorOpen?: (target: PostCardAuthorProfileTarget) => void;
  onWorldOpen?: (worldId: string) => void;
};

function ExploreSkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-3xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_86%,white)] ${className}`} />;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-[88px] flex-col gap-1 px-3 text-center">
      <span
        style={{
          fontFamily: 'var(--nimi-font-mono)',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'color-mix(in srgb, var(--nimi-fg-inverse) 68%, transparent)',
        }}
      >
        {label}
      </span>
      <span
        className="truncate"
        style={{
          fontFamily: 'var(--nimi-font-mono)',
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: 'var(--nimi-fg-inverse)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function StatDivider() {
  return (
    <div
      aria-hidden
      className="self-stretch"
      style={{
        width: 1,
        background: 'color-mix(in srgb, var(--nimi-fg-inverse) 22%, transparent)',
      }}
    />
  );
}

// Featured-world hero. Lives inside the Worlds section per D-EXPL-002: it is a
// World discovery affordance, not a standalone surface.
function FeaturedWorldHero({
  currentBanner,
  onWorldOpen,
}: {
  currentBanner: WorldBanner;
  onWorldOpen?: (worldId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="relative mb-8" data-testid="explore-featured-world">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onWorldOpen?.(currentBanner.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onWorldOpen?.(currentBanner.id);
          }
        }}
        className="relative h-[360px] cursor-pointer overflow-hidden rounded-3xl"
        style={{
          boxShadow: 'var(--nimi-elevation-floating)',
          border: '1px solid var(--nimi-border-subtle)',
        }}
      >
        <div className="absolute inset-0">
          {currentBanner.bannerUrl ? (
            <img
              src={currentBanner.bannerUrl}
              alt={currentBanner.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full" style={{ background: 'var(--nimi-surface-hero)' }} />
          )}
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'linear-gradient(100deg, rgba(8,6,28,0.75) 0%, rgba(8,6,28,0.45) 38%, rgba(8,6,28,0.15) 70%, transparent 100%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'linear-gradient(180deg, transparent 55%, rgba(8,6,28,0.55) 100%)',
          }}
        />
        <div
          className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full px-3 py-1.5 nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
          style={{
            background: 'color-mix(in srgb, var(--nimi-fg-inverse) 14%, transparent)',
            border: '1px solid color-mix(in srgb, var(--nimi-fg-inverse) 28%, transparent)',
          }}
        >
          <span className="desktop-world-pulse-dot" />
          <span
            style={{
              fontFamily: 'var(--nimi-font-mono)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--nimi-fg-inverse)',
            }}
          >
            {t('Explore.featuredWorldLive', { defaultValue: 'Featured world · Live' })}
          </span>
        </div>
        {currentBanner.currentLabel && (
          <div
            className="absolute right-5 top-5 inline-flex items-center rounded-full px-3 py-1.5 nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
            style={{
              background: 'color-mix(in srgb, var(--nimi-fg-inverse) 14%, transparent)',
              border: '1px solid color-mix(in srgb, var(--nimi-fg-inverse) 28%, transparent)',
              fontFamily: 'var(--nimi-font-mono)',
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: '0.02em',
              color: 'var(--nimi-fg-inverse)',
            }}
          >
            {currentBanner.currentLabel}
          </div>
        )}
        <div className="absolute left-20 top-[110px] z-[1] max-w-[58%]">
          {currentBanner.eraLabel && (
            <div
              className="mb-3"
              style={{
                fontFamily: 'var(--nimi-font-mono)',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'color-mix(in srgb, var(--nimi-fg-inverse) 72%, transparent)',
              }}
            >
              {currentBanner.eraLabel}
            </div>
          )}
          <h3
            className="m-0"
            style={{
              fontFamily: 'var(--nimi-font-display)',
              fontSize: 68,
              fontWeight: 700,
              letterSpacing: '-0.035em',
              lineHeight: 1,
              color: 'var(--nimi-fg-inverse)',
            }}
          >
            {currentBanner.name}
          </h3>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onWorldOpen?.(currentBanner.id);
          }}
          className="absolute bottom-5 right-5 z-[1] inline-flex items-center gap-2 rounded-full px-4 py-2 transition-colors"
          style={{
            fontFamily: 'var(--nimi-font-sans)',
            fontSize: 13,
            fontWeight: 600,
            background: 'var(--nimi-accent)',
            color: 'var(--nimi-accent-onAccent)',
            border: '1px solid color-mix(in srgb, var(--nimi-accent) 80%, transparent)',
            boxShadow: 'var(--nimi-elevation-base)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
          {t('Explore.enterWorld', { defaultValue: 'Enter world' })}
        </button>
        {(currentBanner.agentCount !== null || currentBanner.flowRatio !== null || currentBanner.eraLabel) && (
          <div
            className="absolute bottom-5 left-5 flex items-stretch gap-0 rounded-2xl px-4 py-3 nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
            style={{
              background: 'color-mix(in srgb, var(--nimi-fg-inverse) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--nimi-fg-inverse) 22%, transparent)',
            }}
          >
            {currentBanner.agentCount !== null && (
              <StatCell
                label={t('World.totalPlayers', { defaultValue: 'Inhabitants' })}
                value={formatCount(currentBanner.agentCount)}
              />
            )}
            {currentBanner.agentCount !== null && (currentBanner.flowRatio !== null || currentBanner.eraLabel) && (
              <StatDivider />
            )}
            {currentBanner.flowRatio !== null && (
              <StatCell
                label={t('Explore.statChrono', { defaultValue: 'Chrono' })}
                value={`${currentBanner.flowRatio.toFixed(currentBanner.flowRatio < 10 ? 1 : 0)}×`}
              />
            )}
            {currentBanner.flowRatio !== null && currentBanner.eraLabel && <StatDivider />}
            {currentBanner.eraLabel && (
              <StatCell
                label={t('Explore.statEra', { defaultValue: 'Era' })}
                value={currentBanner.eraLabel}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// Agents section: a full browsable RealmAgent discovery grid across Worlds.
// Per D-EXPL-002 this is NOT a truncated carousel — every discovered agent is
// rendered.
function ExploreAgentsSection({
  agents,
  onAgentAddFriend,
  onAgentOpenChat,
  onAgentManageFriends,
  onAgentOpen,
}: {
  agents: ExploreAgentCardData[];
  onAgentAddFriend: (agentId: string) => void;
  onAgentOpenChat: (agentId: string) => void;
  onAgentManageFriends: () => void;
  onAgentOpen?: (agentId: string) => void;
}) {
  const { t } = useTranslation();
  if (agents.length === 0) {
    return (
      <div
        className="rounded-[2rem] border border-dashed p-12 text-center"
        style={{
          borderColor: 'var(--nimi-border-subtle)',
          color: 'var(--nimi-fg-3)',
          fontSize: 13,
          fontFamily: 'var(--nimi-font-sans)',
        }}
        data-testid="explore-agents-empty"
      >
        {t('Explore.agentsEmpty', { defaultValue: 'No agents match the current filters.' })}
      </div>
    );
  }
  return (
    <div
      className="grid items-stretch gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
      data-testid="explore-agents-grid"
    >
      {agents.map((agent) => (
        <AgentRecommendationCard
          key={agent.id}
          agent={agent}
          onAddFriend={() => onAgentAddFriend(agent.id)}
          onOpenChat={() => onAgentOpenChat(agent.id)}
          onManageFriends={onAgentManageFriends}
          onOpen={() => onAgentOpen?.(agent.id)}
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

  // Worlds with banners power the featured-world hero inside the Worlds section.
  const worldsWithBanners = props.worldBanners.filter((w) => w.bannerUrl);

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
        contentClassName="mx-auto w-full max-w-6xl px-1 py-5"
        viewportRef={feedScrollRef}
      >
        {props.activeSection === 'worlds' && (
          <section data-testid="explore-worlds-section">
            {worldsWithBanners[0] && (
              <FeaturedWorldHero
                currentBanner={worldsWithBanners[0]}
                onWorldOpen={props.onWorldOpen}
              />
            )}
            {props.worldsLoading ? (
              <WorldsLoadingSkeleton embedded />
            ) : props.worldsError ? (
              <WorldsLoadError embedded />
            ) : (
              <WorldCatalogContent
                worlds={props.worldCatalogItems}
                onOpenWorld={(worldId) => props.onWorldOpen?.(worldId)}
                embedded
              />
            )}
          </section>
        )}

        {props.activeSection === 'agents' && (
          <section data-testid="explore-agents-section">
            <ExploreSectionHeader section="agents" />
            <ExploreAgentsSection
              agents={props.agents}
              onAgentAddFriend={props.onAgentAddFriend}
              onAgentOpenChat={props.onAgentOpenChat}
              onAgentManageFriends={props.onAgentManageFriends}
              onAgentOpen={props.onAgentOpen}
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
