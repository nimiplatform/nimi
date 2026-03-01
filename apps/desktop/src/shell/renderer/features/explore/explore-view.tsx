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

type ExploreViewProps = {
  searchText: string;
  selectedCategory: string | null;
  categories: string[];
  featuredWorlds: FeaturedWorldCardData[];
  topAgents: ExploreAgentCardData[];
  fetchPostPage: (cursor: string | null) => Promise<{ items: PostDto[]; nextCursor: string | null }>;
  postFeedKey: string;
  onPostDelete?: () => void;
  loading: boolean;
  onSearchTextChange: (value: string) => void;
  onToggleCategory: (category: string) => void;
  onAgentChat: (agentId: string) => void;
  onWorldOpen?: (worldId: string) => void;
};

export function ExploreView(props: ExploreViewProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header bar */}
      <div className="flex h-14 shrink-0 items-center gap-4 bg-white px-6">
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
          {/* Featured Worlds Banner */}
          {props.featuredWorlds.length > 0 && (
            <section className="grid grid-cols-3 gap-4">
              {props.featuredWorlds.map((world) => (
                <FeaturedWorldCard
                  key={world.id}
                  world={world}
                  onClick={() => props.onWorldOpen?.(world.id)}
                />
              ))}
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

          {/* Main content: Feed + Sidebar */}
          <div className="mt-8 flex gap-6">
            {/* Dynamic Feed (main column) — PostFeed */}
            <div className="min-w-0 flex-1">
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

            {/* Sidebar */}
            <div className="flex w-72 shrink-0 flex-col gap-6">
              {/* Top Agents */}
              {props.topAgents.length > 0 && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">Top Agents</h3>
                  <div className="flex flex-col gap-3">
                    {props.topAgents.map((agent) => (
                      <TopAgentCard
                        key={agent.id}
                        agent={agent}
                        onChat={() => props.onAgentChat(agent.id)}
                      />
                    ))}
                  </div>
                </section>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
