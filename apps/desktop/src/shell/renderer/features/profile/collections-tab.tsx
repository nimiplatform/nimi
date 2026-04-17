import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { i18n } from '@renderer/i18n';
import { BLOCKED_USERS_UPDATED_EVENT, dataSync } from '@runtime/data-sync';
import { DesktopCompactAction } from '@renderer/components/action';
import { DesktopCardSurface } from '@renderer/components/surface';
import { PostFeedWithMediaPreview } from './post-feed-with-media-preview.js';

type PostDto = RealmModel<'PostDto'>;

const PAGE_SIZE = 10;
const SAVED_POSTS_STORAGE_KEY = 'nimi.desktop.saved-post-ids';
const SAVED_POSTS_UPDATED_EVENT = 'nimi:saved-posts-updated';

type CollectionsTabProps = {
  profileId: string;
  canManageSavedPosts?: boolean;
  layout?: 'grid' | 'masonry';
};

function CollectionSkeleton() {
  return (
    <DesktopCardSurface kind="promoted-glass" as="div" className="animate-pulse p-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-gray-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-28 rounded bg-gray-200" />
          <div className="h-3 w-20 rounded bg-gray-100" />
        </div>
      </div>
      <div className="mt-4 h-56 rounded-2xl bg-gray-100" />
    </DesktopCardSurface>
  );
}

function readSavedPostIds(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(SAVED_POSTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map((value) => String(value || '').trim()).filter(Boolean).reverse()
      : [];
  } catch {
    return [];
  }
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      return message;
    }
  }
  return fallback;
}

export function CollectionsTab({ canManageSavedPosts = true, layout = 'grid' }: CollectionsTabProps) {
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [posts, setPosts] = useState<PostDto[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);

  const fetchSavedPosts = useCallback(async (startOffset: number) => {
    if (!canManageSavedPosts) {
      setLoadingInitial(false);
      setHasMore(false);
      hasMoreRef.current = false;
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;

    const ids = readSavedPostIds();
    setSavedIds(ids);
    const pageIds = ids.slice(startOffset, startOffset + PAGE_SIZE);
    const isInitial = startOffset === 0;

    if (pageIds.length === 0) {
      if (isInitial) {
        setPosts([]);
        setLoadingInitial(false);
      }
      setHasMore(false);
      hasMoreRef.current = false;
      setOffset(startOffset);
      offsetRef.current = startOffset;
      loadingRef.current = false;
      return;
    }

    try {
      setLoadError(null);
      if (isInitial) {
        setLoadingInitial(true);
      } else {
        setLoadingMore(true);
      }

      const results = await Promise.all(
        pageIds.map(async (postId) => {
          try {
            const post = await dataSync.loadPostById(postId);
            return post as PostDto;
          } catch {
            return null;
          }
        }),
      );

      const nextPosts = results.filter((item): item is PostDto => Boolean(item?.id));
      setPosts((prev) => {
        if (isInitial) {
          return nextPosts;
        }
        const seen = new Set(prev.map((post) => post.id));
        const merged = [...prev];
        for (const post of nextPosts) {
          if (!seen.has(post.id)) {
            merged.push(post);
          }
        }
        return merged;
      });

      const nextOffset = startOffset + pageIds.length;
      setOffset(nextOffset);
      offsetRef.current = nextOffset;
      setHasMore(nextOffset < ids.length);
      hasMoreRef.current = nextOffset < ids.length;
    } catch (error) {
      setLoadError(toErrorMessage(error, i18n.t('Profile.loadSavedPostsFailed', { defaultValue: 'Failed to load saved posts' })));
    } finally {
      loadingRef.current = false;
      if (isInitial) {
        setLoadingInitial(false);
      } else {
        setLoadingMore(false);
      }
    }
  }, [canManageSavedPosts]);

  useEffect(() => {
    setPosts([]);
    setOffset(0);
    offsetRef.current = 0;
    setHasMore(true);
    hasMoreRef.current = true;
    loadingRef.current = false;
    setLoadError(null);
    void fetchSavedPosts(0);
  }, [fetchSavedPosts]);

  useEffect(() => {
    const resetAndFetch = () => {
      setPosts([]);
      setOffset(0);
      offsetRef.current = 0;
      setHasMore(true);
      hasMoreRef.current = true;
      loadingRef.current = false;
      setLoadError(null);
      void fetchSavedPosts(0);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== SAVED_POSTS_STORAGE_KEY) {
        return;
      }
      resetAndFetch();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener(SAVED_POSTS_UPDATED_EVENT, resetAndFetch);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(SAVED_POSTS_UPDATED_EVENT, resetAndFetch);
    };
  }, [fetchSavedPosts]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const handleBlockedUsersUpdated = () => {
      setPosts([]);
      setOffset(0);
      offsetRef.current = 0;
      setHasMore(true);
      hasMoreRef.current = true;
      loadingRef.current = false;
      setLoadError(null);
      void fetchSavedPosts(0);
    };
    window.addEventListener(BLOCKED_USERS_UPDATED_EVENT, handleBlockedUsersUpdated);
    return () => window.removeEventListener(BLOCKED_USERS_UPDATED_EVENT, handleBlockedUsersUpdated);
  }, [fetchSavedPosts]);

  useEffect(() => {
    if (!hasMore) return;
    const el = loadMoreRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasMoreRef.current && !loadingRef.current) {
          void fetchSavedPosts(offsetRef.current);
        }
      },
      { rootMargin: '200px', threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchSavedPosts, hasMore]);

  if (!canManageSavedPosts) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-sm text-gray-400">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 text-gray-300">
          <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
        </svg>
        <p className="text-center">
          {i18n.t('Profile.Collections.selfOnly', {
            defaultValue: 'Saved posts are only visible on your own profile.',
          })}
        </p>
      </div>
    );
  }

  if (loadingInitial) {
    return (
      <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2">
        <CollectionSkeleton />
        <CollectionSkeleton />
        <CollectionSkeleton />
      </div>
    );
  }

  if (loadError && posts.length === 0) {
    return (
      <DesktopCardSurface kind="operational-solid" as="div" className="p-4 text-sm text-red-700">
        <p>{loadError}</p>
        <DesktopCompactAction tone="danger" onClick={() => { void fetchSavedPosts(0); }} className="mt-3">
          Retry
        </DesktopCompactAction>
      </DesktopCardSurface>
    );
  }

  if (savedIds.length === 0 || posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-sm text-gray-400">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 text-gray-300">
          <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
        </svg>
        No saved posts yet
      </div>
    );
  }

  return (
    <PostFeedWithMediaPreview
      posts={posts}
      loadError={loadError}
      loadingMore={loadingMore}
      loadMoreRef={loadMoreRef}
      retryLabel="Retry"
      skeleton={<CollectionSkeleton />}
      onRetryLoadMore={() => { void fetchSavedPosts(offset); }}
      layout={layout}
      onDeletePost={(postId) => {
        setPosts((current) => current.filter((item) => item.id !== postId));
      }}
    />
  );
}
