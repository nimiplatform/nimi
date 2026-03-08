import { useEffect, useRef, useState } from 'react';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { PostCard } from '@renderer/features/home/post-card';

type PostFeedWithMediaPreviewProps = {
  posts: PostDto[];
  loadError: string | null;
  loadingMore: boolean;
  loadMoreRef: React.RefObject<HTMLDivElement | null>;
  retryLabel: string;
  skeleton: React.ReactNode;
  onRetryLoadMore: () => void;
  onDeletePost?: (postId: string) => void;
};

export function PostFeedWithMediaPreview({
  posts,
  loadError,
  loadingMore,
  loadMoreRef,
  retryLabel,
  skeleton,
  onRetryLoadMore,
  onDeletePost,
}: PostFeedWithMediaPreviewProps) {
  const [focusedPostId, setFocusedPostId] = useState<string | null>(null);
  const postRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!focusedPostId) {
      return;
    }
    const timer = window.setTimeout(() => setFocusedPostId(null), 1800);
    return () => window.clearTimeout(timer);
  }, [focusedPostId]);

  return (
    <div className="space-y-8">
      <section className="columns-1 gap-6 md:columns-2">
        {posts.map((post) => (
          <div
            key={post.id}
            ref={(node) => {
              postRefs.current[post.id] = node;
            }}
            className={`mb-6 break-inside-avoid scroll-mt-6 transition-all duration-500 ${
              focusedPostId === post.id ? 'rounded-[28px] ring-2 ring-[#4ECCA3]/55 ring-offset-4 ring-offset-[#f7f9fc]' : ''
            }`}
          >
            <PostCard
              post={post}
              onDelete={onDeletePost ? () => onDeletePost(post.id) : undefined}
            />
          </div>
        ))}
        {loadError ? (
          <div className="mb-6 break-inside-avoid rounded-2xl border border-red-200/60 bg-red-50/80 px-4 py-3 text-xs text-red-700 backdrop-blur-sm">
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
        {loadingMore ? <div className="mb-6">{skeleton}</div> : null}
        <div ref={loadMoreRef} className="h-1" />
      </section>
    </div>
  );
}
