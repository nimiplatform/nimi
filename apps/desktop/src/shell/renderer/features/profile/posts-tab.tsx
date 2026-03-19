import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { PostFeedWithMediaPreview } from './post-feed-with-media-preview.js';

type PostDto = RealmModel<'PostDto'>;

const PAGE_SIZE = 15;

type PostsTabProps = {
  profileId: string;
  layout?: 'grid' | 'masonry';
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      return message;
    }
  }
  return fallback;
}

function PostSkeleton() {
  return (
    <div className="animate-pulse rounded-[24px] border border-white/70 bg-white/80 p-5 shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-gray-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="h-3 w-20 rounded bg-gray-100" />
        </div>
      </div>
      <div className="mt-4 h-56 rounded-[20px] bg-gray-100" />
    </div>
  );
}

export function PostsTab({ profileId, layout = 'grid' }: PostsTabProps) {
  const { t } = useTranslation();
  const [posts, setPosts] = useState<PostDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const fetchPosts = useCallback(
    async (cursorArg: string | null) => {
      if (cursorArg && (loadingMore || !hasMore)) return;
      try {
        setLoadError(null);
        if (cursorArg) {
          setLoadingMore(true);
        } else {
          setLoadingInitial(true);
        }
        const data = await dataSync.loadPostFeed({
          authorId: profileId,
          limit: PAGE_SIZE,
          cursor: cursorArg ?? undefined,
        });
        const newItems = data?.items ?? [];
        const nextCursor = data?.page?.nextCursor ?? null;

        setPosts((prev) => {
          if (!cursorArg) return newItems;
          const seen = new Set(prev.map((post) => post.id));
          const merged = [...prev];
          for (const post of newItems) {
            if (!seen.has(post.id)) {
              merged.push(post);
            }
          }
          return merged;
        });
        setCursor(nextCursor);
        setHasMore(nextCursor != null);
      } catch (error) {
        setLoadError(toErrorMessage(error, t('Profile.loadPostsFailed', { defaultValue: 'Failed to load posts' })));
      } finally {
        if (cursorArg) {
          setLoadingMore(false);
        } else {
          setLoadingInitial(false);
        }
      }
    },
    [hasMore, loadingMore, profileId],
  );

  useEffect(() => {
    setPosts([]);
    setCursor(null);
    setHasMore(true);
    setLoadError(null);
    void fetchPosts(null);
  }, [profileId]);

  useEffect(() => {
    if (!hasMore) return;
    const el = loadMoreRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasMore && !loadingMore && cursor) {
          void fetchPosts(cursor);
        }
      },
      { rootMargin: '200px', threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, fetchPosts, hasMore, loadingMore]);

  if (loadingInitial) {
    return (
      <div className="grid grid-cols-1 items-start gap-6 min-[980px]:grid-cols-2">
        <PostSkeleton />
        <PostSkeleton />
        <PostSkeleton />
      </div>
    );
  }

  if (loadError && posts.length === 0) {
    return (
      <div className="rounded-2xl border border-red-200/60 bg-red-50/80 p-4 text-sm text-red-700 backdrop-blur-sm">
        <p>{loadError}</p>
        <button
          type="button"
          onClick={() => { void fetchPosts(null); }}
          className="mt-3 rounded-xl bg-red-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-red-600"
        >
          {t('Common.retry')}
        </button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-sm text-gray-400">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 text-gray-300">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        {t('PostsTab.noPosts')}
      </div>
    );
  }

  return (
    <PostFeedWithMediaPreview
      posts={posts}
      loadError={loadError}
      loadingMore={loadingMore}
      loadMoreRef={loadMoreRef}
      retryLabel={t('Common.retry')}
      skeleton={<PostSkeleton />}
      onRetryLoadMore={() => { void fetchPosts(cursor); }}
      layout={layout}
      onDeletePost={(postId) => {
        setPosts((current) => current.filter((item) => item.id !== postId));
      }}
    />
  );
}
