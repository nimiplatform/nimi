import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PostDto } from '@nimiplatform/sdk/realm';
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header bar */}
      <div className="flex h-14 shrink-0 items-center gap-4 bg-gray-50 px-6">
        <h1 className="text-lg font-semibold tracking-tight text-gray-900">
          {t('Explore.pageTitle')}
        </h1>
        <div className="ml-4 flex max-w-md flex-1 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <svg
            width="16"
            height="16"
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
            className="ml-2 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
            placeholder={t('Explore.searchPlaceholder')}
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
                <h2 className="text-[19px] font-semibold leading-7 text-gray-900 mb-3" style={{ fontFamily: '"Noto Sans SC", "Source Han Sans SC", sans-serif' }}>Worlds</h2>
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
              <h3 className="mb-4 text-[17px] font-semibold leading-6 text-gray-900" style={{ fontFamily: '"Noto Sans SC", "Source Han Sans SC", sans-serif' }}>
                Top Agents
              </h3>
              <div className="relative">
                <div
                  className="flex gap-4 overflow-x-auto pb-2"
                  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                  {props.topAgents.map((agent) => (
                    <AgentRecommendationCard
                      key={agent.id}
                      agent={agent}
                      onAddFriend={() => props.onAgentAddFriend(agent.id)}
                      onOpen={() => props.onAgentOpen?.(agent.id)}
                    />
                  ))}
                </div>
                <div className="pointer-events-none absolute bottom-2 right-0 top-0 w-10 bg-gradient-to-l from-gray-50 to-transparent" />
              </div>
            </section>
          )}

          <section className="mt-10">
            <h2 className="mb-4 text-[19px] font-semibold leading-7 text-gray-900" style={{ fontFamily: '"Noto Sans SC", "Source Han Sans SC", sans-serif' }}>
              Dynamic Feed
            </h2>
            <PostFeed
              key={props.postFeedKey}
              fetchPage={props.fetchPostPage}
              emptyText={t('Explore.noPosts')}
              renderItem={(post) => (
                <PostCard post={post} onDelete={props.onPostDelete} />
              )}
              className="grid grid-cols-2 gap-4"
            />
          </section>
        </div>
      </div>
    </div>
  );
}
