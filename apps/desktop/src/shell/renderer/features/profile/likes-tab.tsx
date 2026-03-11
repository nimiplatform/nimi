import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';
import { PostFeedWithMediaPreview } from './post-feed-with-media-preview.js';

const PAGE_SIZE = 20;

type LikesTabProps = {
  profileId: string;
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

function LikeSkeleton() {
  return (
    <div className="animate-pulse rounded-[24px] border border-white/70 bg-white/80 p-5 shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-gray-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="h-3 w-20 rounded bg-gray-100" />
        </div>
      </div>
      <div className="mt-4 h-52 rounded-[20px] bg-gray-100" />
    </div>
  );
}

export function LikesTab({ profileId }: LikesTabProps) {
  const { t } = useTranslation();
  const [likedPosts, setLikedPosts] = useState<PostDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const fetchLiked = useCallback(
    async (cursorArg: string | null) => {
      if (cursorArg && (loadingMore || !hasMore)) return;
      try {
        setLoadError(null);
        if (cursorArg) {
          setLoadingMore(true);
        } else {
          setLoadingInitial(true);
        }
        const data = await dataSync.callApi((realm) => realm.services.PostService.listLikedPosts(undefined, PAGE_SIZE, cursorArg ?? undefined, profileId));
        const newItems = Array.isArray(data?.items) ? (data.items as PostDto[]) : [];
        const nextCursor = data?.page?.nextCursor ?? null;

        setLikedPosts((prev) => {
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
        setLoadError(toErrorMessage(error, t('Profile.loadLikedPostsFailed', { defaultValue: 'Failed to load liked posts' })));
      } finally {
        if (cursorArg) {
          setLoadingMore(false);
        } else {
          setLoadingInitial(false);
        }
      }
    },
    [hasMore, loadingMore, profileId, t],
  );

  useEffect(() => {
    setLikedPosts([]);
    setCursor(null);
    setHasMore(true);
    setLoadError(null);
    void fetchLiked(null);
  }, [profileId]);

  useEffect(() => {
    if (!hasMore) return;
    const el = loadMoreRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasMore && !loadingMore && cursor) {
          void fetchLiked(cursor);
        }
      },
      { rootMargin: '200px', threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, fetchLiked, hasMore, loadingMore]);

  if (loadingInitial) {
    return (
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
        <LikeSkeleton />
        <LikeSkeleton />
        <LikeSkeleton />
      </div>
    );
  }

  if (loadError && likedPosts.length === 0) {
    return (
      <div className="rounded-2xl border border-red-200/60 bg-red-50/80 p-4 text-sm text-red-700 backdrop-blur-sm">
        <p>{loadError}</p>
        <button
          type="button"
          onClick={() => { void fetchLiked(null); }}
          className="mt-3 rounded-xl bg-red-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-red-600"
        >
          Retry
        </button>
      </div>
    );
  }

  if (likedPosts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-sm text-gray-400">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 text-gray-300">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        No liked posts yet
      </div>
    );
  }

  return (
    <PostFeedWithMediaPreview
      posts={likedPosts}
      loadError={loadError}
      loadingMore={loadingMore}
      loadMoreRef={loadMoreRef}
      retryLabel="Retry"
      skeleton={<LikeSkeleton />}
      onRetryLoadMore={() => { void fetchLiked(cursor); }}
      onDeletePost={(postId) => {
        setLikedPosts((current) => current.filter((item) => item.id !== postId));
      }}
    />
  );
}
