import { useMemo, useRef, useState } from 'react';
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
  return <div className={`animate-pulse rounded-3xl bg-white/80 ${className}`} />;
}

export function ExploreView(props: ExploreViewProps) {
  const { t } = useTranslation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [topAgentsPage, setTopAgentsPage] = useState(0);
  const [topAgentsDirection, setTopAgentsDirection] = useState<'forward' | 'backward'>('forward');

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
      <Surface data-testid={E2E_IDS.panel('explore')} tone="canvas" padding="none" className="flex min-h-0 flex-1 flex-col rounded-none border-0">
        <div className="shrink-0 px-6 py-4">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
            <ExploreSkeletonBlock className="h-9 w-40 rounded-xl" />
            <ExploreSkeletonBlock className="h-11 w-[300px] rounded-full" />
          </div>
        </div>
        <ScrollArea className="flex-1" viewportClassName="bg-transparent" contentClassName="mx-auto max-w-6xl space-y-10 px-6 py-8">
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
      </Surface>
    );
  }

  return (
    <Surface data-testid={E2E_IDS.panel('explore')} tone="canvas" padding="none" className="flex min-h-0 flex-1 flex-col rounded-none border-0">
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
      <div className="shrink-0 px-6 py-4">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
          <h1 className={`nimi-type-page-title text-[color:var(--nimi-text-primary)]`}>
            {t('Explore.pageTitle')}
          </h1>
          <div className="w-[300px] shrink-0">
            <Surface tone="card" elevation="base" padding="none" className="group relative flex h-11 items-center rounded-full border-white/70 px-4">
              <span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-mint-600">
                {ICON_SEARCH}
              </span>
              <input
                type="search"
                className="w-full bg-transparent py-2.5 pl-7 pr-1 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0"
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
        contentClassName="mx-auto max-w-6xl px-6 py-8"
      >
          {/* World Banner Carousel */}
          {worldsWithBanners.length > 0 && (
            <section className="relative mb-10">
              {/* Worlds Title */}
              <div className="mb-3">
                <h2 className={`nimi-type-section-title text-[color:var(--nimi-text-primary)] mb-3`} style={{ fontFamily: 'var(--font-display)' }}>
                  {t('World.title')}
                </h2>
              </div>
              <Surface
                tone="hero"
                elevation="floating"
                padding="none"
                className="relative h-[280px] cursor-pointer overflow-hidden rounded-2xl border-white/60"
                onClick={() => currentBanner && props.onWorldOpen?.(currentBanner.id)}
              >
                {/* Banner Images Container with Animation */}
                <div 
                  className="flex h-full transition-transform duration-700 ease-in-out will-change-transform"
                  style={{ transform: `translateX(-${currentBannerIndex * 100}%)` }}
                >
                  {worldsWithBanners.map((world, _idx) => (
                    <div key={world.id} className="w-full h-full flex-shrink-0 relative">
                      <img
                        src={world.bannerUrl || ''}
                        alt={world.name}
                        className="w-full h-full object-cover"
                      />
                      {/* Gradient Overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                      {/* World Info */}
                      <div className="absolute bottom-4 left-4">
                        <h3 className="text-2xl font-bold text-white">{world.name}</h3>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Prev Button - Left */}
                {worldsWithBanners.length > 1 && (
                  <IconButton
                    onClick={(e) => {
                      e.stopPropagation();
                      prevBanner();
                    }}
                    tone="ghost"
                    icon={(
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    )}
                    className="absolute left-4 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full bg-white/20 text-white backdrop-blur-sm hover:bg-white/30 hover:text-white"
                    aria-label={t('Explore.previousBanner', { defaultValue: 'Previous banner' })}
                  />
                )}
                
                {/* Next Button - Right */}
                {worldsWithBanners.length > 1 && (
                  <IconButton
                    onClick={(e) => {
                      e.stopPropagation();
                      nextBanner();
                    }}
                    tone="ghost"
                    icon={(
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    )}
                    className="absolute right-4 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full bg-white/20 text-white backdrop-blur-sm hover:bg-white/30 hover:text-white"
                    aria-label={t('Explore.nextBanner', { defaultValue: 'Next banner' })}
                  />
                )}
                
                {/* Dots Indicator */}
                {worldsWithBanners.length > 1 && (
                  <div className="absolute bottom-4 right-4 flex gap-1.5">
                    {worldsWithBanners.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentBannerIndex(idx);
                        }}
                        className={`w-2 h-2 rounded-full transition-colors ${
                          idx === currentBannerIndex ? 'bg-white' : 'bg-white/40'
                        }`}
                        aria-label={`Go to banner ${idx + 1}`}
                      />
                    ))}
                  </div>
                )}
              </Surface>
            </section>
          )}

          {props.topAgents.length > 0 && (
            <section className="mb-10">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className={`nimi-type-section-title text-[color:var(--nimi-text-primary)]`} style={{ fontFamily: 'var(--font-display)' }}>
                  {t('Explore.topAgents', { defaultValue: 'Top Agents' })}
                </h3>
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
                    className="h-7 w-7 shrink-0 text-gray-400 hover:text-gray-700"
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

          <section className="mt-12">
            <div className="mb-6 flex items-center justify-between">
              <h2 className={`nimi-type-section-title text-[color:var(--nimi-text-primary)]`} style={{ fontFamily: 'var(--font-display)' }}>
                {t('Explore.dynamicFeed', { defaultValue: 'Dynamic Feed' })}
              </h2>
            </div>
            <PostFeed
              key={props.postFeedKey}
              fetchPage={props.fetchPostPage}
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
        className="fixed bottom-6 right-6 z-50 h-12 w-12 text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 hover:text-gray-900"
        aria-label={t('Explore.backToTop', { defaultValue: 'Back to top' })}
        title={t('Explore.backToTop', { defaultValue: 'Back to top' })}
      />
    </Surface>
  );
}
