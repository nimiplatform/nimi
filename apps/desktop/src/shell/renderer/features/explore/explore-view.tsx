import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { PostCard } from '../home/post-card';
import { PostFeed } from '../home/post-feed';
import {
  FeaturedWorldCard,
  TopAgentCard,
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
        <div className="mx-auto max-w-6xl px-6 py-6">
          {/* World Banner Carousel */}
          {worldsWithBanners.length > 0 && (
            <section className="relative mb-6">
              <div
                className="relative h-[200px] rounded-2xl overflow-hidden cursor-pointer"
                onClick={() => currentBanner && props.onWorldOpen?.(currentBanner.id)}
              >
                {/* Banner Image */}
                <img
                  src={currentBanner?.bannerUrl || ''}
                  alt={currentBanner?.name || 'World'}
                  className="w-full h-full object-cover transition-opacity duration-300"
                />
                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                {/* World Info */}
                <div className="absolute bottom-4 left-4">
                  <h3 className="text-xl font-bold text-white">{currentBanner?.name}</h3>
                  <span className="text-sm text-white/80">{currentBanner?.type}</span>
                </div>
                {/* Next Button */}
                {worldsWithBanners.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      nextBanner();
                    }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm flex items-center justify-center transition-colors"
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

          {/* Category Chips */}
          <section className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => props.onToggleCategory('')}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                props.selectedCategory === null
                  ? 'bg-mint-500 text-white shadow-sm'
                  : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              All
            </button>
            {props.categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => props.onToggleCategory(cat)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  props.selectedCategory === cat
                    ? 'bg-mint-500 text-white shadow-sm'
                    : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {cat}
              </button>
            ))}
          </section>

          {/* Main content: Top Agents + Dynamic Feed */}
          <div className="mt-8 flex gap-6">
            {/* Left Sidebar: Top Agents */}
            <div className="flex w-72 shrink-0 flex-col gap-6 order-1">
              {props.topAgents.length > 0 && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">Top Agents</h3>
                  <div className="flex flex-col gap-3">
                    {props.topAgents.map((agent) => (
                       <TopAgentCard
                        key={agent.id}
                        agent={agent}
                        onAddFriend={() => props.onAgentAddFriend(agent.id)}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Right: Dynamic Feed */}
            <div className="min-w-0 flex-1 order-2">
              <h2 className="mb-4 text-base font-semibold text-gray-900">Dynamic Feed</h2>
              <PostFeed
                key={props.postFeedKey}
                fetchPage={props.fetchPostPage}
                emptyText={t('Explore.noPosts')}
                renderItem={(post) => (
                  <PostCard post={post} onDelete={props.onPostDelete} />
                )}
                className="grid grid-cols-2 gap-4"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
