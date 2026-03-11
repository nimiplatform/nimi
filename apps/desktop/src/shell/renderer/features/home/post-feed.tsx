import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { i18n } from '@renderer/i18n';
import type { PostDto } from '@nimiplatform/sdk/realm';

export type FeedItem = PostDto;

type PageResult = {
  items: FeedItem[];
  nextCursor: string | null;
};

type ApiError = {
  status?: number;
  message?: string;
  body?: { message?: string };
  response?: { status?: number };
};

type PostFeedProps = {
  fetchPage: (cursor: string | null) => Promise<PageResult>;
  emptyText?: string;
  renderItem?: (item: FeedItem, index: number) => ReactNode;
  className?: string;
};

const PostSkeleton = () => (
  <div className="mb-6 rounded-[2rem] border border-border bg-card p-5 shadow-sm">
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
      <div className="space-y-1">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-3 w-16 animate-pulse rounded bg-muted" />
      </div>
    </div>
    <div className="mt-4 space-y-2">
      <div className="h-4 w-full animate-pulse rounded bg-muted" />
      <div className="h-4 w-[90%] animate-pulse rounded bg-muted" />
      <div className="h-4 w-[80%] animate-pulse rounded bg-muted" />
    </div>
    <div className="mt-4 h-[200px] w-full animate-pulse rounded-2xl bg-muted" />
  </div>
);

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    ('status' in error || 'message' in error || 'body' in error || 'response' in error)
  );
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const next = error.message.trim();
    if (next) {
      return next;
    }
  }
  return fallback;
}

export function PostFeed({ fetchPage, emptyText, renderItem, className }: PostFeedProps) {
  const [posts, setPosts] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(loadingMore);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  const load = useCallback(
    async (cursorArg: string | null) => {
      if (cursorArg && (loadingMoreRef.current || !hasMoreRef.current)) {
        return;
      }

      try {
        setError(null);
        if (cursorArg) {
          setLoadingMore(true);
        } else {
          setLoadingInitial(true);
        }

        const { items, nextCursor } = await fetchPage(cursorArg);

        if (items.length === 0) {
          setHasMore(false);
          setCursor(null);
          if (cursorArg) {
            setLoadingMore(false);
            return;
          }
        }

        setPosts((prev) => {
          if (prev.length === 0) {
            return items;
          }

          const seen = new Set(prev.map((item) => item.id));
          const merged = [...prev];
          for (const item of items) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              merged.push(item);
            }
          }
          return merged;
        });

        setCursor(nextCursor);
        setHasMore(nextCursor != null);
      } catch (loadError: unknown) {
        if (
          !loadError ||
          (typeof loadError === 'object' &&
            loadError !== null &&
            Object.keys(loadError as object).length === 0)
        ) {
          setError(i18n.t('Home.feedConnectionFailed', {
            defaultValue: 'Unable to connect to server. Check your network or backend status.',
          }));
        } else {
          if (isApiError(loadError)) {
            if (loadError.status === 401 || loadError.response?.status === 401) {
              setError(i18n.t('Home.feedSessionExpired', {
                defaultValue: 'Your session has expired. Please sign in again.',
              }));
            } else {
              const errorMessage = loadError.message
                || loadError.body?.message
                || i18n.t('Home.unknownError', { defaultValue: 'Unknown error' });
              setError(i18n.t('Home.feedLoadFailed', {
                message: errorMessage,
                defaultValue: 'Failed to load feed: {{message}}',
              }));
            }
          } else {
            setError(i18n.t('Home.feedLoadFailed', {
              message: toErrorMessage(
                loadError,
                i18n.t('Home.unknownError', { defaultValue: 'Unknown error' }),
              ),
              defaultValue: 'Failed to load feed: {{message}}',
            }));
          }
        }
      } finally {
        if (cursorArg) {
          setLoadingMore(false);
        } else {
          setLoadingInitial(false);
        }
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  useEffect(() => {
    if (!hasMore) {
      return;
    }
    const target = loadMoreRef.current;
    if (!target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        if (entry.isIntersecting && hasMore && !loadingMore && cursor) {
          void load(cursor);
        }
      },
      {
        root: null,
        rootMargin: '200px',
        threshold: 0.1,
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, hasMore, loadingMore, load]);

  return (
    <>
      {error ? (
        <div className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className={className ?? 'space-y-6'}>
        {posts.map((post, index) =>
          renderItem ? (
            <Fragment key={post.id}>{renderItem(post, index)}</Fragment>
          ) : (
            <div key={post.id} className="rounded-[10px] border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-700">
                {post.caption ?? i18n.t('Home.noContent', { defaultValue: 'No content' })}
              </p>
            </div>
          ),
        )}

        {!loadingInitial && posts.length === 0 && !error ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {emptyText ?? i18n.t('Home.noPosts', { defaultValue: 'No posts yet' })}
          </div>
        ) : null}
      </div>

      <div ref={loadMoreRef} className="h-10" />

      {loadingInitial || loadingMore ? (
        <div className="space-y-6">
          <PostSkeleton />
          {loadingInitial ? (
            <>
              <PostSkeleton />
              <PostSkeleton />
            </>
          ) : null}
        </div>
      ) : null}

      {!hasMore && posts.length > 0 && !loadingMore ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          {i18n.t('Home.caughtUp', { defaultValue: "You're all caught up!" })}
        </div>
      ) : null}
    </>
  );
}
