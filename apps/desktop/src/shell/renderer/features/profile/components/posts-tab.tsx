import { useCallback, useEffect, useRef, useState } from 'react';
import type { PostDto } from '@nimiplatform/sdk-realm/models/PostDto';
import { dataSync } from '@runtime/data-sync';

const PAGE_SIZE = 15;

type PostsTabProps = {
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

function PostCard({ post }: { post: PostDto }) {
  const hasMedia = post.media && post.media.length > 0;
  const firstImage = hasMedia ? post.media.find((m) => m.type === 'IMAGE') : null;
  const isAgent = Boolean(post.author?.isAgent);

  return (
    <div className="rounded-2xl border border-white/60 bg-white/70 p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)] backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-start gap-3">
        {post.author?.avatarUrl ? (
          <img 
            src={post.author.avatarUrl} 
            alt="" 
            className={`h-10 w-10 shrink-0 object-cover ${isAgent ? 'rounded-xl' : 'rounded-full'}`}
            style={isAgent ? {
              boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4)'
            } : undefined}
          />
        ) : (
          <div 
            className={`flex h-10 w-10 shrink-0 items-center justify-center text-sm font-medium ${
              isAgent 
                ? 'rounded-xl bg-slate-100 text-slate-700' 
                : 'rounded-full bg-gradient-to-br from-[#E0F7F4] to-[#C5F0E8] text-[#4ECCA3]'
            }`}
            style={isAgent ? {
              boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4)'
            } : undefined}
          >
            {(post.author?.displayName || '?').charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800">{post.author?.displayName || 'Unknown'}</span>
            <span className="text-xs text-gray-400">
              {new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        </div>
      </div>

      {/* Caption */}
      {post.caption ? (
        <p className="mt-3 text-sm leading-relaxed text-gray-700">{post.caption}</p>
      ) : null}

      {/* Image */}
      {firstImage?.url ? (
        <div className="mt-4 overflow-hidden rounded-2xl">
          <img 
            src={firstImage.url} 
            alt="" 
            className="h-auto w-full object-cover" 
            style={{ maxHeight: 400 }} 
          />
        </div>
      ) : null}
    </div>
  );
}

function PostSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-white/60 bg-white/70 p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-gray-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="h-3 w-full rounded bg-gray-100" />
        </div>
      </div>
      <div className="mt-4 h-48 w-full rounded-2xl bg-gray-100" />
    </div>
  );
}

export function PostsTab({ profileId }: PostsTabProps) {
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
        setLoadError(toErrorMessage(error, 'Failed to load posts'));
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
    fetchPosts(null);
  }, [profileId]);

  useEffect(() => {
    if (!hasMore) return;
    const el = loadMoreRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasMore && !loadingMore && cursor) {
          fetchPosts(cursor);
        }
      },
      { rootMargin: '200px', threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, hasMore, loadingMore, fetchPosts]);

  if (loadingInitial) {
    return (
      <div className="flex flex-col gap-3">
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
          Retry
        </button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-white/60 bg-white/40 py-16 text-sm text-gray-400 backdrop-blur-sm">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 text-gray-300">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        No posts yet
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
      {loadError ? (
        <div className="rounded-2xl border border-red-200/60 bg-red-50/80 px-4 py-3 text-xs text-red-700 backdrop-blur-sm">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => { void fetchPosts(cursor); }}
            className="mt-2 rounded-lg bg-red-500 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-red-600"
          >
            Retry
          </button>
        </div>
      ) : null}
      {loadingMore ? <PostSkeleton /> : null}
      <div ref={loadMoreRef} className="h-1" />
    </div>
  );
}
