import { useEffect, useMemo, useRef, useState } from 'react';
import { IconButton, ScrollArea, Surface } from '@nimiplatform/nimi-kit/ui';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { PostCard, type PostCardAuthorProfileTarget } from '../home/post-card';
import { PostFeed } from '../home/post-feed';
import {
  AgentRecommendationCard,
  type ExploreAgentCardData,
  type FeaturedWorldCardData,
} from './explore-cards';

type PostDto = RealmModel<'PostDto'>;

const ICON_SEARCH = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

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
  searchText: string;
  selectedCategory: string | null;
  categories: string[];
  featuredWorlds: FeaturedWorldCardData[];
  topAgents: ExploreAgentCardData[];
  worldBanners: WorldBanner[];
  fetchPostPage: (cursor: string | null) => Promise<{ items: PostDto[]; nextCursor: string | null }>;
  postFeedKey: string;
  onPostDelete?: () => void;
  loading: boolean;
  onSearchTextChange: (value: string) => void;
  onToggleCategory: (category: string) => void;
  onAgentAddFriend: (agentId: string) => void;
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

export function ExploreView(props: ExploreViewProps) {
  const { t } = useTranslation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const feedSectionRef = useRef<HTMLElement>(null);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [topAgentsPage, setTopAgentsPage] = useState(0);
  const [topAgentsDirection, setTopAgentsDirection] = useState<'forward' | 'backward'>('forward');
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

  // Filter worlds with banners
  const worldsWithBanners = props.worldBanners.filter((w) => w.bannerUrl);
  const currentBanner = worldsWithBanners[currentBannerIndex];

  const nextBanner = () => {
    if (worldsWithBanners.length > 1) {
      setCurrentBannerIndex((prev) => (prev + 1) % worldsWithBanners.length);
    }
  };

  const prevBanner = () => {
    if (worldsWithBanners.length > 1) {
      setCurrentBannerIndex((prev) => (prev - 1 + worldsWithBanners.length) % worldsWithBanners.length);
    }
  };

  const topAgentsPageSize = 4;
  const topAgentsPages = useMemo(() => {
    const chunks: ExploreViewProps['topAgents'][] = [];
    for (let index = 0; index < props.topAgents.length; index += topAgentsPageSize) {
      chunks.push(props.topAgents.slice(index, index + topAgentsPageSize));
    }
    return chunks;
  }, [props.topAgents]);
  const activeTopAgents = topAgentsPages[topAgentsPage] || [];
  const hasPreviousTopAgentsPage = topAgentsPage > 0;
  const hasNextTopAgentsPage = topAgentsPage < topAgentsPages.length - 1;

  const handleTopAgentsPageChange = () => {
    if (hasNextTopAgentsPage) {
      setTopAgentsDirection('forward');
      setTopAgentsPage((current) => current + 1);
      return;
    }
    if (hasPreviousTopAgentsPage) {
      setTopAgentsDirection('backward');
      setTopAgentsPage((current) => current - 1);
    }
  };

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (props.loading) {
    return (
      <div data-testid={E2E_IDS.panel('explore')} className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
        <div className="shrink-0">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4">
            <ExploreSkeletonBlock className="h-9 w-40 rounded-xl" />
            <ExploreSkeletonBlock className="h-11 w-[300px] rounded-full" />
          </div>
        </div>
        <ScrollArea className="flex-1" viewportClassName="bg-transparent" contentClassName="mx-auto w-full max-w-6xl space-y-10 px-1 py-5">
            <section className="space-y-3">
              <ExploreSkeletonBlock className="h-6 w-24 rounded-lg" />
              <ExploreSkeletonBlock className="h-[280px] w-full rounded-[2rem]" />
            </section>
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <ExploreSkeletonBlock className="h-6 w-28 rounded-lg" />
                <ExploreSkeletonBlock className="h-7 w-7 rounded-full" />
              </div>
              <div className="flex gap-4 overflow-hidden">
                {Array.from({ length: 4 }).map((_, index) => (
                  <ExploreSkeletonBlock key={index} className="h-[210px] min-w-[260px] flex-1 rounded-[2rem]" />
                ))}
              </div>
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
                    <div className="mt-4 space-y-2">
                      <ExploreSkeletonBlock className="h-4 w-full rounded" />
                      <ExploreSkeletonBlock className="h-4 w-5/6 rounded" />
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
      <style>{`
        @keyframes top-agents-slide-forward {
          from { opacity: 0; transform: translateX(18px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes top-agents-slide-backward {
          from { opacity: 0; transform: translateX(-18px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      {/* Header bar */}
      <div className="shrink-0">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-4 px-5 py-4">
          <div>
            <div className="nimi-kicker-tiny mb-3">{t('Explore.pageKicker', { defaultValue: 'Nimi · Explore' })}</div>
            <h1
              className="m-0 leading-none"
              style={{
                fontFamily: 'var(--nimi-font-display)',
                fontSize: 40,
                fontWeight: 700,
                letterSpacing: '-0.032em',
                color: 'var(--nimi-fg-1)',
              }}
            >
              {t('Explore.pageTitle')}
            </h1>
          </div>
          <div className="w-[300px] shrink-0">
            <Surface
              tone="panel"
              material="glass-thick"
              elevation="base"
              padding="none"
              className="group relative flex h-11 items-center rounded-full border-white/70 px-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]"
            >
              <span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-[color:var(--nimi-fg-3)] transition-colors group-focus-within:text-[color:var(--nimi-accent)]">
                {ICON_SEARCH}
              </span>
              <input
                type="search"
                className="w-full bg-transparent py-2.5 pl-7 pr-1 text-sm text-[color:var(--nimi-fg-1)] outline-none placeholder:text-[color:var(--nimi-fg-3)] focus:ring-0"
                style={{ fontFamily: 'var(--nimi-font-sans)' }}
                placeholder={t('Explore.searchPlaceholder', { defaultValue: 'Search worlds, agents, posts...' })}
                value={props.searchText}
                onChange={(e) => props.onSearchTextChange(e.target.value)}
              />
            </Surface>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <ScrollArea
        ref={scrollContainerRef}
        className="min-h-0 flex-1"
        viewportClassName="bg-transparent"
        contentClassName="mx-auto w-full max-w-6xl px-1 py-5"
        viewportRef={feedScrollRef}
      >
          {/* Featured world hero */}
          {worldsWithBanners.length > 0 && currentBanner && (
            <section className="relative mb-10">
              <div className="mb-4">
                <h2
                  className="m-0"
                  style={{
                    fontFamily: 'var(--nimi-font-display)',
                    fontSize: 26,
                    fontWeight: 600,
                    letterSpacing: '-0.02em',
                    color: 'var(--nimi-fg-1)',
                    lineHeight: 1.1,
                  }}
                >
                  {t('Explore.featuredWorld', { defaultValue: 'Featured world' })}
                </h2>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() => props.onWorldOpen?.(currentBanner.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    props.onWorldOpen?.(currentBanner.id);
                  }
                }}
                className="relative h-[360px] cursor-pointer overflow-hidden rounded-3xl"
                style={{
                  boxShadow: 'var(--nimi-elevation-floating)',
                  border: '1px solid var(--nimi-border-subtle)',
                }}
              >
                {/* Rotating cover layer */}
                <div
                  className="flex h-full transition-transform duration-700 ease-in-out will-change-transform"
                  style={{ transform: `translateX(-${currentBannerIndex * 100}%)` }}
                >
                  {worldsWithBanners.map((world) => (
                    <div key={world.id} className="relative h-full w-full flex-shrink-0">
                      {world.bannerUrl ? (
                        <img
                          src={world.bannerUrl}
                          alt={world.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="h-full w-full" style={{ background: 'var(--nimi-surface-hero)' }} />
                      )}
                    </div>
                  ))}
                </div>

                {/* Left-weighted dark wash + bottom vignette */}
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

                {/* Top-left glass chip: live state */}
                <div
                  className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full px-3 py-1.5"
                  style={{
                    background: 'color-mix(in srgb, var(--nimi-fg-inverse) 14%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--nimi-fg-inverse) 28%, transparent)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                  }}
                >
                  <span className="nimi-world-pulse-dot" />
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

                {/* Top-right glass chip: mono world date */}
                {currentBanner.currentLabel && (
                  <div
                    className="absolute right-5 top-5 inline-flex items-center rounded-full px-3 py-1.5"
                    style={{
                      background: 'color-mix(in srgb, var(--nimi-fg-inverse) 14%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--nimi-fg-inverse) 28%, transparent)',
                      backdropFilter: 'blur(12px)',
                      WebkitBackdropFilter: 'blur(12px)',
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

                {/* Headline block (left column) */}
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
                  {currentBanner.tagline && (
                    <p
                      className="mt-3 line-clamp-2"
                      style={{
                        fontFamily: 'var(--nimi-font-sans)',
                        fontSize: 15,
                        lineHeight: 1.5,
                        color: 'color-mix(in srgb, var(--nimi-fg-inverse) 78%, transparent)',
                        margin: 0,
                        maxWidth: 520,
                      }}
                    >
                      {currentBanner.tagline}
                    </p>
                  )}

                  {/* CTA row */}
                  <div className="mt-5 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onWorldOpen?.(currentBanner.id);
                      }}
                      className="inline-flex items-center gap-2 rounded-full px-4 py-2 transition-colors"
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
                  </div>
                </div>

                {/* Stat rail (bottom-right) */}
                {(currentBanner.agentCount !== null || currentBanner.flowRatio !== null || currentBanner.eraLabel) && (
                  <div
                    className="absolute bottom-5 right-5 flex items-stretch gap-0 rounded-2xl px-4 py-3"
                    style={{
                      background: 'color-mix(in srgb, var(--nimi-fg-inverse) 12%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--nimi-fg-inverse) 22%, transparent)',
                      backdropFilter: 'blur(14px)',
                      WebkitBackdropFilter: 'blur(14px)',
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

                {/* Page indicator dots (bottom-left) */}
                {worldsWithBanners.length > 1 && (
                  <div className="absolute bottom-7 left-8 flex items-center gap-1.5">
                    {worldsWithBanners.map((_, idx) => {
                      const active = idx === currentBannerIndex;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCurrentBannerIndex(idx);
                          }}
                          aria-label={t('Explore.goToBanner', { defaultValue: 'Go to banner', idx: idx + 1 })}
                          className="h-1.5 rounded-full transition-all"
                          style={{
                            width: active ? 20 : 6,
                            background: active
                              ? 'var(--nimi-fg-inverse)'
                              : 'color-mix(in srgb, var(--nimi-fg-inverse) 42%, transparent)',
                            border: 0,
                          }}
                        />
                      );
                    })}
                  </div>
                )}

                {/* Prev / Next arrows */}
                {worldsWithBanners.length > 1 && (
                  <>
                    <IconButton
                      onClick={(e) => {
                        e.stopPropagation();
                        prevBanner();
                      }}
                      tone="ghost"
                      icon={(
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="15 18 9 12 15 6" />
                        </svg>
                      )}
                      className="absolute left-4 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full"
                      style={{
                        background: 'color-mix(in srgb, var(--nimi-fg-inverse) 14%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--nimi-fg-inverse) 24%, transparent)',
                        color: 'var(--nimi-fg-inverse)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                      }}
                      aria-label={t('Explore.previousBanner', { defaultValue: 'Previous banner' })}
                    />
                    <IconButton
                      onClick={(e) => {
                        e.stopPropagation();
                        nextBanner();
                      }}
                      tone="ghost"
                      icon={(
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      )}
                      className="absolute right-4 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full"
                      style={{
                        background: 'color-mix(in srgb, var(--nimi-fg-inverse) 14%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--nimi-fg-inverse) 24%, transparent)',
                        color: 'var(--nimi-fg-inverse)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                      }}
                      aria-label={t('Explore.nextBanner', { defaultValue: 'Next banner' })}
                    />
                  </>
                )}
              </div>
            </section>
          )}

          {props.topAgents.length > 0 && (
            <section className="mb-10">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2
                    className="m-0"
                    style={{
                      fontFamily: 'var(--nimi-font-display)',
                      fontSize: 26,
                      fontWeight: 600,
                      letterSpacing: '-0.02em',
                      color: 'var(--nimi-fg-1)',
                      lineHeight: 1.1,
                    }}
                  >
                    {t('Explore.topAgents', { defaultValue: 'Top Agents' })}
                  </h2>
                </div>
                {topAgentsPages.length > 1 ? (
                  <IconButton
                    onClick={handleTopAgentsPageChange}
                    icon={hasNextTopAgentsPage ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    )}
                    className="h-8 w-8 shrink-0 rounded-full border border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-accent-soft)] text-[color:var(--nimi-fg-2)] shadow-[0_10px_24px_rgba(15,23,42,0.05)] hover:border-[color:var(--nimi-border-strong)] hover:text-[color:var(--nimi-accent)]"
                    aria-label={hasNextTopAgentsPage
                      ? t('Explore.nextTopAgentsPage', { defaultValue: 'Next top agents page' })
                      : t('Explore.previousTopAgentsPage', { defaultValue: 'Previous top agents page' })}
                    title={hasNextTopAgentsPage
                      ? t('ChatTimeline.nextPage', { defaultValue: 'Next page' })
                      : t('ChatTimeline.previousPage', { defaultValue: 'Previous page' })}
                  />
                ) : null}
              </div>
              <div
                key={`top-agents-page-${topAgentsPage}`}
                className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                style={{
                  animation: topAgentsDirection === 'forward'
                    ? 'top-agents-slide-forward 220ms ease-out'
                    : 'top-agents-slide-backward 220ms ease-out',
                }}
              >
                {activeTopAgents.map((agent) => (
                  <div key={agent.id} className="w-[260px] min-w-[260px] shrink-0">
                    <AgentRecommendationCard
                      agent={agent}
                      onAddFriend={() => props.onAgentAddFriend(agent.id)}
                      onOpen={() => props.onAgentOpen?.(agent.id)}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          <section ref={feedSectionRef} className="mt-12">
            <div className="mb-6 flex items-center justify-between">
              <h2 className={`nimi-type-section-title text-[color:var(--nimi-text-secondary)]`} style={{ fontFamily: 'var(--font-display)' }}>
                {t('Explore.dynamicFeed', { defaultValue: 'Dynamic Feed' })}
              </h2>
            </div>
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
                    onDelete={props.onPostDelete}
                    onOpenAuthorProfile={props.onPostAuthorOpen}
                  />
                </div>
              )}
              className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2"
            />
          </section>
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
