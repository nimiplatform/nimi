import { useCallback, useEffect, useRef, useState } from 'react';
import { PostService } from '@nimiplatform/sdk/realm';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { PostMediaType } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';

const MEDIA_PAGE_SIZE = 30;
const MIN_INITIAL_ITEMS = 9;

type MediaTabProps = {
  profileId: string;
  onMediaClick: (post: PostDto, mediaIndex: number) => void;
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

function MediaSkeleton() {
  return (
    <div className="animate-pulse rounded-md bg-gray-200" style={{ aspectRatio: '1' }} />
  );
}

export function MediaTab({ profileId, onMediaClick }: MediaTabProps) {
  const [mediaPosts, setMediaPosts] = useState<PostDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const fetchMedia = useCallback(
    async (cursorArg: string | null, isAutoFetch = false) => {
      if (cursorArg && !isAutoFetch && (loadingMore || !hasMore)) return;
      try {
        if (!isAutoFetch) {
          setLoadError(null);
        }
        if (!isAutoFetch) {
          if (cursorArg) {
            setLoadingMore(true);
          } else {
            setLoadingInitial(true);
          }
        }
        const data = await dataSync.callApi(() =>
          PostService.getHomeFeed(undefined, undefined, profileId, undefined, MEDIA_PAGE_SIZE, cursorArg ?? undefined),
        );
        const allItems = data?.items ?? [];
        const nextCursor = data?.page?.nextCursor ?? null;
        const mediaItems = allItems.filter((p) => p.media && p.media.length > 0);

        setMediaPosts((prev) => {
          if (!cursorArg) return mediaItems;
          const seen = new Set(prev.map((p) => p.id));
          const merged = [...prev];
          for (const p of mediaItems) {
            if (!seen.has(p.id)) merged.push(p);
          }
          return merged;
        });
        setCursor(nextCursor);
        setHasMore(nextCursor != null);

        // Auto-fetch more if not enough media in first batch
        if (!cursorArg && nextCursor && mediaItems.length < MIN_INITIAL_ITEMS) {
          void fetchMedia(nextCursor, true);
        }
      } catch (error) {
        setLoadError(toErrorMessage(error, 'Failed to load media'));
      } finally {
        if (!isAutoFetch) {
          if (cursorArg) {
            setLoadingMore(false);
          } else {
            setLoadingInitial(false);
          }
        }
      }
    },
    [hasMore, loadingMore, profileId],
  );

  useEffect(() => {
    setMediaPosts([]);
    setCursor(null);
    setHasMore(true);
    setLoadError(null);
    fetchMedia(null);
  }, [profileId]);

  useEffect(() => {
    if (!hasMore) return;
    const el = loadMoreRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasMore && !loadingMore && cursor) {
          fetchMedia(cursor);
        }
      },
      { rootMargin: '200px', threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, hasMore, loadingMore, fetchMedia]);

  // Flatten all media items for grid display
  const mediaItems: { post: PostDto; mediaIndex: number; url: string; type: PostMediaType; thumbnail?: string }[] = [];
  for (const post of mediaPosts) {
    for (let i = 0; i < post.media.length; i++) {
      const m = post.media[i];
      if (m && m.url) {
        mediaItems.push({
          post,
          mediaIndex: i,
          url: m.url,
          type: m.type,
          thumbnail: m.thumbnail,
        });
      }
    }
  }

  if (loadingInitial) {
    return (
      <div className="grid grid-cols-3 gap-1">
        {Array.from({ length: 9 }).map((_, i) => (
          <MediaSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (loadError && mediaItems.length === 0) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>{loadError}</p>
        <button
          type="button"
          onClick={() => { void fetchMedia(null); }}
          className="mt-3 rounded-[10px] bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (mediaItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-sm text-gray-400">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 text-gray-300">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        No media yet
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-1">
        {mediaItems.map((item, idx) => (
          <button
            key={`${item.post.id}-${item.mediaIndex}`}
            type="button"
            onClick={() => onMediaClick(item.post, item.mediaIndex)}
            className="group relative overflow-hidden rounded-md bg-gray-100"
            style={{ aspectRatio: '1' }}
          >
            <img
              src={item.thumbnail || item.url}
              alt=""
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
              loading={idx < 9 ? 'eager' : 'lazy'}
            />
            {item.type === PostMediaType.VIDEO ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white" className="drop-shadow">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </div>
            ) : null}
          </button>
        ))}
      </div>
      {loadError ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => { void fetchMedia(cursor); }}
            className="mt-2 rounded-[8px] bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      ) : null}
      {loadingMore ? (
        <div className="mt-1 grid grid-cols-3 gap-1">
          <MediaSkeleton />
          <MediaSkeleton />
          <MediaSkeleton />
        </div>
      ) : null}
      <div ref={loadMoreRef} className="h-1" />
    </div>
  );
}
