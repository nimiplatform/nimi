import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { BLOCKED_USERS_UPDATED_EVENT, dataSync } from '@runtime/data-sync';
import { DesktopCompactAction } from '@renderer/components/action';
import { DesktopCardSurface } from '@renderer/components/surface';
import { PostFeedWithMediaPreview } from './post-feed-with-media-preview.js';

type PostDto = RealmModel<'PostDto'>;

const PAGE_SIZE = 15;

type PostsTabProps = {
  profileId: string;
  layout?: 'grid' | 'masonry';
  blockedContent?: boolean;
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
    <DesktopCardSurface kind="promoted-glass" as="div" className="animate-pulse p-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-gray-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="h-3 w-20 rounded bg-gray-100" />
        </div>
      </div>
      <div className="mt-4 h-56 rounded-2xl bg-gray-100" />
    </DesktopCardSurface>
  );
}

export function PostsTab({ profileId, layout = 'grid', blockedContent = false }: PostsTabProps) {
  const { t } = useTranslation();
  const [posts, setPosts] = useState<PostDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);

  const fetchPosts = useCallback(
    async (cursorArg: string | null) => {
      if (blockedContent) {
        setPosts([]);
        setCursor(null);
        setHasMore(false);
        hasMoreRef.current = false;
        setLoadError(null);
        setLoadingInitial(false);
        setLoadingMore(false);
        loadingRef.current = false;
        return;
      }
      if (cursorArg && (loadingRef.current || !hasMoreRef.current)) return;
      if (loadingRef.current) return;
      loadingRef.current = true;
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
        hasMoreRef.current = nextCursor != null;
      } catch (error) {
        setLoadError(toErrorMessage(error, t('Profile.loadPostsFailed', { defaultValue: 'Failed to load posts' })));
      } finally {
        loadingRef.current = false;
        if (cursorArg) {
          setLoadingMore(false);
        } else {
          setLoadingInitial(false);
        }
      }
    },
    [blockedContent, profileId, t],
  );

  useEffect(() => {
    setPosts([]);
    setCursor(null);
    setHasMore(true);
    hasMoreRef.current = true;
    loadingRef.current = false;
    setLoadError(null);
    if (blockedContent) {
      setLoadingInitial(false);
      setLoadingMore(false);
      return;
    }
    void fetchPosts(null);
  }, [blockedContent, fetchPosts, profileId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const handleBlockedUsersUpdated = () => {
      setPosts([]);
      setCursor(null);
      setHasMore(true);
      setLoadError(null);
      if (blockedContent) {
        setLoadingInitial(false);
        setLoadingMore(false);
        return;
      }
      void fetchPosts(null);
    };
    window.addEventListener(BLOCKED_USERS_UPDATED_EVENT, handleBlockedUsersUpdated);
    return () => window.removeEventListener(BLOCKED_USERS_UPDATED_EVENT, handleBlockedUsersUpdated);
  }, [blockedContent, fetchPosts]);

  const cursorRef = useRef<string | null>(null);
  cursorRef.current = cursor;

  useEffect(() => {
    if (!hasMore) return;
    const el = loadMoreRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasMoreRef.current && !loadingRef.current && cursorRef.current) {
          void fetchPosts(cursorRef.current);
        }
      },
      { rootMargin: '200px', threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, fetchPosts]);

  if (loadingInitial) {
    return (
      <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2">
        <PostSkeleton />
        <PostSkeleton />
        <PostSkeleton />
      </div>
    );
  }

  if (loadError && posts.length === 0) {
    return (
      <DesktopCardSurface kind="operational-solid" as="div" className="p-4 text-sm text-red-700">
        <p>{loadError}</p>
        <DesktopCompactAction tone="danger" onClick={() => { void fetchPosts(null); }} className="mt-3">
          {t('Common.retry')}
        </DesktopCompactAction>
      </DesktopCardSurface>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-sm text-gray-400">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 text-gray-300">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        {blockedContent
          ? t('Profile.blockedPostsHidden', { defaultValue: 'Posts from this user are hidden because you blocked them.' })
          : t('PostsTab.noPosts')}
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
