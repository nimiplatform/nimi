import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { APP_DISPLAY_SECTION_TITLE_CLASS, APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import { PostCard } from '../home/post-card';
import { PostFeed } from '../home/post-feed';
import {
  AgentRecommendationCard,
  type ExploreAgentCardData,
  type FeaturedWorldCardData,
} from './explore-cards';

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
  onWorldOpen?: (worldId: string) => void;
};

export function ExploreView(props: ExploreViewProps) {
  const { t } = useTranslation();
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
      <div className="flex h-14 shrink-0 items-center justify-between bg-gray-50 px-6 border-b border-gray-100">
        <h1 className={APP_PAGE_TITLE_CLASS}>
          {t('Explore.pageTitle')}
        </h1>
        <div className="flex w-64 items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 transition-all focus-within:border-mint-500/50 focus-within:ring-2 focus-within:ring-mint-500/10">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9ca3af"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="ml-2 flex-1 bg-transparent text-xs text-gray-900 outline-none placeholder:text-gray-400 font-light"
            placeholder=""
            value={props.searchText}
            onChange={(e) => props.onSearchTextChange(e.target.value)}
          />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        <div className="mx-auto max-w-6xl px-6 py-8">
          {/* World Banner Carousel */}
          {worldsWithBanners.length > 0 && (
            <section className="relative mb-10">
              {/* Worlds Title */}
              <div className="mb-3">
                <h2 className={`${APP_DISPLAY_SECTION_TITLE_CLASS} mb-3`} style={{ fontFamily: 'var(--font-display)' }}>Worlds</h2>
              </div>
              <div
                className="relative h-[280px] rounded-2xl overflow-hidden cursor-pointer"
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
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      prevBanner();
                    }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm flex items-center justify-center transition-colors z-10"
                    aria-label="Previous banner"
                  >
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
                  </button>
                )}
                
                {/* Next Button - Right */}
                {worldsWithBanners.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      nextBanner();
                    }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm flex items-center justify-center transition-colors z-10"
                    aria-label="Next banner"
                  >
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
                  </button>
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
              </div>
            </section>
          )}

          {props.topAgents.length > 0 && (
            <section className="mb-10">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className={APP_DISPLAY_SECTION_TITLE_CLASS} style={{ fontFamily: 'var(--font-display)' }}>
                  Top Agents
                </h3>
                {topAgentsPages.length > 1 ? (
                  <button
                    type="button"
                    onClick={handleTopAgentsPageChange}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-700"
                    aria-label={hasNextTopAgentsPage ? 'Next top agents page' : 'Previous top agents page'}
                    title={hasNextTopAgentsPage ? 'Next' : 'Previous'}
                  >
                    {hasNextTopAgentsPage ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    )}
                  </button>
                ) : null}
              </div>
              <div
                key={`top-agents-page-${topAgentsPage}`}
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
                style={{
                  animation: topAgentsDirection === 'forward'
                    ? 'top-agents-slide-forward 220ms ease-out'
                    : 'top-agents-slide-backward 220ms ease-out',
                }}
              >
                {activeTopAgents.map((agent) => (
                  <div key={agent.id} className="min-w-0">
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
              <h2 className={`${APP_DISPLAY_SECTION_TITLE_CLASS}`} style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.1em' }}>
                Dynamic Feed
              </h2>
              <div className="h-[1px] flex-1 mx-6 bg-gradient-to-r from-gray-200 to-transparent opacity-50" />
            </div>
            <PostFeed
              key={props.postFeedKey}
              fetchPage={props.fetchPostPage}
              emptyText={t('Explore.noPosts')}
              renderItem={(post) => (
                <div className="break-inside-avoid mb-6">
                  <PostCard post={post} onDelete={props.onPostDelete} />
                </div>
              )}
              className="columns-1 sm:columns-2 gap-6"
            />
          </section>
        </div>
      </div>
    </div>
  );
}
