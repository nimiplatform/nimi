import { useCallback, useEffect, useRef, useState } from 'react';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';

const PAGE_SIZE = 20;

type CollectionsTabProps = {
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

function LikedPostCard({ post }: { post: PostDto }) {
  const firstImage = post.media?.find((m) => m.type === 'IMAGE');
  const thumbnailUrl = firstImage?.thumbnail || firstImage?.url;
  const isAgent = Boolean(post.author?.isAgent);

  return (
    <div className="overflow-hidden rounded-[10px] border border-gray-200 bg-white">
      {thumbnailUrl ? (
        <div className="aspect-video overflow-hidden bg-gray-100">
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="flex aspect-video items-center justify-center bg-gray-50">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-300">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
      )}
      <div className="p-3">
        <div className="flex items-center gap-2">
          {post.author?.avatarUrl ? (
            <img 
              src={post.author.avatarUrl} 
              alt="" 
              className="h-5 w-5 object-cover rounded"
              style={isAgent ? {
                boxShadow: '0 0 0 1px #a855f7, 0 0 2px 1px rgba(168, 85, 247, 0.4)'
              } : undefined}
            />
          ) : (
            <div 
              className={`flex h-5 w-5 items-center justify-center text-[10px] font-medium rounded ${
                isAgent 
                  ? 'bg-gradient-to-br from-[#4ECCA3] to-[#3DBB94] text-white' 
                  : 'bg-gray-100 text-gray-500'
              }`}
              style={isAgent ? {
                boxShadow: '0 0 0 1px #a855f7, 0 0 2px 1px rgba(168, 85, 247, 0.4)'
              } : undefined}
            >
              {(post.author?.displayName || '?').charAt(0)}
            </div>
          )}
          <span className="truncate text-xs font-medium text-gray-700">{post.author?.displayName || 'Unknown'}</span>
        </div>
        {post.caption ? (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-gray-500">{post.caption}</p>
        ) : null}
      </div>
    </div>
  );
}

function CollectionSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-[10px] border border-gray-200 bg-white">
      <div className="aspect-video bg-gray-200" />
      <div className="space-y-2 p-3">
        <div className="h-3 w-20 rounded bg-gray-200" />
        <div className="h-3 w-full rounded bg-gray-100" />
      </div>
    </div>
  );
}

export function CollectionsTab({ profileId }: CollectionsTabProps) {
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
        const data = await dataSync.callApi((realm) => realm.services.PostService.listLikedPosts(undefined, PAGE_SIZE, cursorArg ?? undefined, profileId),
        );
        const newItems = data?.items ?? [];
        const nextCursor = data?.page?.nextCursor ?? null;

        setLikedPosts((prev) => {
          if (!cursorArg) return newItems;
          const seen = new Set(prev.map((p) => p.id));
          const merged = [...prev];
          for (const p of newItems) {
            if (!seen.has(p.id)) merged.push(p);
          }
          return merged;
        });
        setCursor(nextCursor);
        setHasMore(nextCursor != null);
      } catch (error) {
        setLoadError(toErrorMessage(error, 'Failed to load collections'));
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
    setLikedPosts([]);
    setCursor(null);
    setHasMore(true);
    setLoadError(null);
    fetchLiked(null);
  }, [profileId]);

  useEffect(() => {
    if (!hasMore) return;
    const el = loadMoreRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasMore && !loadingMore && cursor) {
          fetchLiked(cursor);
        }
      },
      { rootMargin: '200px', threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, hasMore, loadingMore, fetchLiked]);

  if (loadingInitial) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <CollectionSkeleton />
        <CollectionSkeleton />
        <CollectionSkeleton />
        <CollectionSkeleton />
      </div>
    );
  }

  if (loadError && likedPosts.length === 0) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>{loadError}</p>
        <button
          type="button"
          onClick={() => { void fetchLiked(null); }}
          className="mt-3 rounded-[10px] bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
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
    <div>
      <div className="grid grid-cols-2 gap-3">
        {likedPosts.map((post) => (
          <LikedPostCard key={post.id} post={post} />
        ))}
      </div>
      {loadError ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => { void fetchLiked(cursor); }}
            className="mt-2 rounded-[8px] bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      ) : null}
      {loadingMore ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <CollectionSkeleton />
          <CollectionSkeleton />
        </div>
      ) : null}
      <div ref={loadMoreRef} className="h-1" />
    </div>
  );
}
