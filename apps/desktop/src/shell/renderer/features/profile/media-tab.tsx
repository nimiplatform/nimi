import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { BLOCKED_USERS_UPDATED_EVENT, dataSync } from '@runtime/data-sync';
import { useTranslation } from 'react-i18next';
import { DesktopCompactAction } from '@renderer/components/action';
import { DesktopCardSurface } from '@renderer/components/surface';
import {
  normalizeMediaType,
  resolveRenderableMediaAttachment,
} from '@renderer/features/home/utils.js';

type PostDto = RealmModel<'PostDto'>;
type MediaGridItem = { post: PostDto; mediaIndex: number; url: string; type: 'IMAGE' | 'VIDEO'; thumbnail?: string };

const MEDIA_PAGE_SIZE = 30;
const MIN_INITIAL_ITEMS = 9;

type MediaTabProps = {
  profileId: string;
  onMediaClick: (post: PostDto, mediaIndex: number) => void;
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

function MediaSkeleton() {
  return (
    <DesktopCardSurface kind="promoted-glass" as="div" className="animate-pulse overflow-hidden p-2">
      <div className="rounded-2xl bg-gray-200" style={{ aspectRatio: '1' }} />
    </DesktopCardSurface>
  );
}

export function MediaTab({ profileId, onMediaClick, blockedContent = false }: MediaTabProps) {
  const { t } = useTranslation();
  const [mediaPosts, setMediaPosts] = useState<PostDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);

  const fetchMedia = useCallback(
    async (cursorArg: string | null, isAutoFetch = false) => {
      if (blockedContent) {
        setMediaPosts([]);
        setCursor(null);
        setHasMore(false);
        hasMoreRef.current = false;
        setLoadError(null);
        setLoadingInitial(false);
        setLoadingMore(false);
        loadingRef.current = false;
        return;
      }
      if (cursorArg && !isAutoFetch && (loadingRef.current || !hasMoreRef.current)) return;
      if (loadingRef.current) return;
      loadingRef.current = true;
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
        const data = await dataSync.loadPostFeed({
          authorId: profileId,
          limit: MEDIA_PAGE_SIZE,
          cursor: cursorArg ?? undefined,
        });
        const allItems = Array.isArray(data?.items) ? (data.items as PostDto[]) : [];
        const nextCursor = data?.page?.nextCursor ?? null;
        const mediaItems = allItems.filter((p) => Array.isArray(p.attachments) && p.attachments.length > 0);

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
        hasMoreRef.current = nextCursor != null;

        // Auto-fetch more if not enough media in first batch
        if (!cursorArg && nextCursor && mediaItems.length < MIN_INITIAL_ITEMS) {
          loadingRef.current = false;
          void fetchMedia(nextCursor, true);
          return;
        }
      } catch (error) {
        setLoadError(toErrorMessage(error, t('Profile.loadMediaFailed', { defaultValue: 'Failed to load media' })));
      } finally {
        loadingRef.current = false;
        if (!isAutoFetch) {
          if (cursorArg) {
            setLoadingMore(false);
          } else {
            setLoadingInitial(false);
          }
        }
      }
    },
    [blockedContent, profileId, t],
  );

  useEffect(() => {
    setMediaPosts([]);
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
    void fetchMedia(null);
  }, [blockedContent, fetchMedia, profileId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const handleBlockedUsersUpdated = () => {
      setMediaPosts([]);
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
      void fetchMedia(null);
    };
    window.addEventListener(BLOCKED_USERS_UPDATED_EVENT, handleBlockedUsersUpdated);
    return () => window.removeEventListener(BLOCKED_USERS_UPDATED_EVENT, handleBlockedUsersUpdated);
  }, [blockedContent, fetchMedia]);

  const cursorRef = useRef<string | null>(null);
  cursorRef.current = cursor;

  useEffect(() => {
    if (!hasMore) return;
    const el = loadMoreRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasMoreRef.current && !loadingRef.current && cursorRef.current) {
          void fetchMedia(cursorRef.current);
        }
      },
      { rootMargin: '200px', threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, fetchMedia]);

  // Flatten all media items for grid display
  const mediaItems: MediaGridItem[] = [];
  for (const post of mediaPosts) {
    for (let i = 0; i < post.attachments.length; i++) {
      const m = post.attachments[i];
      const renderable = resolveRenderableMediaAttachment(m);
      const attachmentKind = normalizeMediaType(renderable?.displayKind);
      const url = String(renderable?.url || '').trim();
      if (renderable && url && (attachmentKind === 'IMAGE' || attachmentKind === 'VIDEO')) {
        mediaItems.push({
          post,
          mediaIndex: i,
          url,
          type: attachmentKind,
          thumbnail: String(renderable.thumbnail || '').trim() || undefined,
        });
      }
    }
  }

  if (loadingInitial) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <MediaSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (loadError && mediaItems.length === 0) {
    return (
      <DesktopCardSurface kind="operational-solid" as="div" className="p-4 text-sm text-red-700">
        <p>{loadError}</p>
        <DesktopCompactAction tone="danger" onClick={() => { void fetchMedia(null); }} className="mt-3">
          Retry
        </DesktopCompactAction>
      </DesktopCardSurface>
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
        {blockedContent
          ? t('Profile.blockedMediaHidden', { defaultValue: 'Media from this user is hidden because you blocked them.' })
          : t('Profile.noMediaYet', { defaultValue: 'No media yet' })}
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {mediaItems.map((item, idx) => (
          <DesktopCardSurface
            key={`${item.post.id}-${item.mediaIndex}`}
            as="button"
            kind="promoted-glass"
            interactive
            onClick={() => onMediaClick(item.post, item.mediaIndex)}
            className="group relative overflow-hidden p-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(15,23,42,0.08)]"
          >
            <div className="relative overflow-hidden rounded-2xl bg-gray-100" style={{ aspectRatio: '1' }}>
              <img
                src={item.thumbnail || item.url}
                alt=""
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                loading={idx < 9 ? 'eager' : 'lazy'}
              />
              {item.type === 'VIDEO' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="white" className="drop-shadow">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </div>
              ) : null}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/35 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-[#111827] opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                Open
              </div>
            </div>
          </DesktopCardSurface>
        ))}
      </div>
      {loadError ? (
        <DesktopCardSurface kind="operational-solid" as="div" className="mt-3 px-4 py-3 text-xs text-red-700">
          <p>{loadError}</p>
          <DesktopCompactAction tone="danger" onClick={() => { void fetchMedia(cursor); }} className="mt-2">
            Retry
          </DesktopCompactAction>
        </DesktopCardSurface>
      ) : null}
      {loadingMore ? (
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          <MediaSkeleton />
          <MediaSkeleton />
          <MediaSkeleton />
        </div>
      ) : null}
      <div ref={loadMoreRef} className="h-1" />
    </div>
  );
}
