import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { PostCard } from '@renderer/features/home/post-card';

type PostDto = RealmModel<'PostDto'>;

const ROW_ESTIMATED_HEIGHT = 360;
const ROW_GAP = 24;
const VIRTUALIZER_OVERSCAN = 3;

type PostFeedWithMediaPreviewProps = {
  posts: PostDto[];
  loadError: string | null;
  loadingMore: boolean;
  loadMoreRef: React.RefObject<HTMLDivElement | null>;
  retryLabel: string;
  skeleton: React.ReactNode;
  onRetryLoadMore: () => void;
  onDeletePost?: (postId: string) => void;
  layout?: 'grid' | 'masonry';
  scrollRef?: RefObject<HTMLElement | null>;
};

/** Walk up the DOM to find the nearest scrollable ancestor. */
function findScrollParent(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current) {
    const style = getComputedStyle(current);
    if (
      style.overflowY === 'auto' || style.overflowY === 'scroll'
      || style.overflow === 'auto' || style.overflow === 'scroll'
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/** Chunk an array into groups of `size`. */
function chunkRows<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

export function PostFeedWithMediaPreview({
  posts,
  loadError,
  loadingMore,
  loadMoreRef,
  retryLabel,
  skeleton,
  onRetryLoadMore,
  onDeletePost,
  layout = 'grid',
  scrollRef,
}: PostFeedWithMediaPreviewProps) {
  const [focusedPostId, setFocusedPostId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [detectedScrollEl, setDetectedScrollEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!focusedPostId) {
      return;
    }
    const timer = window.setTimeout(() => setFocusedPostId(null), 1800);
    return () => window.clearTimeout(timer);
  }, [focusedPostId]);

  // Auto-detect scroll parent when no explicit scrollRef is provided.
  useEffect(() => {
    if (scrollRef) return;
    const el = containerRef.current;
    if (!el) return;
    // Defer to next frame so layout has settled.
    const raf = requestAnimationFrame(() => {
      setDetectedScrollEl(findScrollParent(el));
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollRef]);

  const scrollElement = scrollRef?.current ?? detectedScrollEl;
  const isGrid = layout !== 'masonry';
  const rows = useMemo(() => (isGrid ? chunkRows(posts, 2) : []), [isGrid, posts]);
  const useVirtual = isGrid && rows.length > 0 && scrollElement != null;

  const virtualizer = useVirtualizer({
    count: useVirtual ? rows.length : 0,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_ESTIMATED_HEIGHT + ROW_GAP,
    overscan: VIRTUALIZER_OVERSCAN,
    enabled: useVirtual,
  });

  const renderCard = (post: PostDto) => (
    <div
      key={post.id}
      className={`scroll-mt-6 transition-all duration-500 ${
        focusedPostId === post.id ? 'rounded-[28px] ring-2 ring-[#4ECCA3]/55 ring-offset-4 ring-offset-[#f7f9fc]' : ''
      }`}
    >
      <PostCard
        post={post}
        onDelete={onDeletePost ? () => onDeletePost(post.id) : undefined}
      />
    </div>
  );

  // --- Masonry fallback: original full-render path ---
  if (!isGrid) {
    return (
      <div className="space-y-8">
        <section className="columns-1 gap-6 sm:columns-2">
          {posts.map((post) => (
            <div key={post.id} className="mb-6 break-inside-avoid">
              {renderCard(post)}
            </div>
          ))}
          {loadingMore ? (
            <div className="mb-6 break-inside-avoid">{skeleton}</div>
          ) : null}
        </section>
        {loadError ? (
          <div className="rounded-2xl border border-red-200/60 bg-red-50/80 px-4 py-3 text-xs text-red-700 backdrop-blur-sm">
            <p>{loadError}</p>
            <button
              type="button"
              onClick={onRetryLoadMore}
              className="mt-2 rounded-lg bg-red-500 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-red-600"
            >
              {retryLabel}
            </button>
          </div>
        ) : null}
        <div ref={loadMoreRef} className="h-1" />
      </div>
    );
  }

  // --- Grid path: virtualized when scroll element is available, fallback otherwise ---
  return (
    <div ref={containerRef} className="space-y-8">
      {useVirtual ? (
        <section
          style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={virtualRow.index}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                  paddingBottom: ROW_GAP,
                }}
              >
                <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2">
                  {row.map((post) => renderCard(post))}
                </div>
              </div>
            );
          })}
        </section>
      ) : (
        <section className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2">
          {posts.map((post) => renderCard(post))}
          {loadingMore ? (
            <div className="sm:col-span-2">{skeleton}</div>
          ) : null}
        </section>
      )}

      {/* Loading more skeleton — outside virtualizer for virtualized path */}
      {useVirtual && loadingMore ? (
        <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2">
          <div className="sm:col-span-2">{skeleton}</div>
        </div>
      ) : null}

      {loadError ? (
        <div className="rounded-2xl border border-red-200/60 bg-red-50/80 px-4 py-3 text-xs text-red-700 backdrop-blur-sm">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={onRetryLoadMore}
            className="mt-2 rounded-lg bg-red-500 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-red-600"
          >
            {retryLabel}
          </button>
        </div>
      ) : null}
      <div ref={loadMoreRef} className="h-1" />
    </div>
  );
}
