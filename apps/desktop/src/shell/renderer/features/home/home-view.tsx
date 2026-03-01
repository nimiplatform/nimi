import { useCallback, useEffect, useRef, useState } from 'react';
import { dataSync } from '@runtime/data-sync';
import { CreatePostModal } from '../profile/components/create-post-modal';
import { PostCard } from './post-card';
import { PostFeed } from './post-feed';

// Optimistic post placeholder component
function PublishingPostCard() {
  return (
    <div className="mb-6 rounded-[2rem] border border-[#4ECCA3]/30 bg-white p-5 shadow-sm opacity-80">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 animate-pulse rounded-full bg-[#4ECCA3]/20" />
        <div className="space-y-1">
          <div className="h-4 w-24 animate-pulse rounded bg-[#4ECCA3]/20" />
          <div className="h-3 w-16 animate-pulse rounded bg-[#4ECCA3]/20" />
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-[#4ECCA3]">
          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
          </svg>
          Publishing...
        </span>
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-[#4ECCA3]/10" />
        <div className="h-4 w-[90%] animate-pulse rounded bg-[#4ECCA3]/10" />
      </div>
      <div className="mt-4 h-[200px] w-full animate-pulse rounded-2xl bg-[#4ECCA3]/10" />
    </div>
  );
}

// Toast notification component
function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-full px-4 py-2.5 shadow-lg animate-in fade-in slide-in-from-bottom-2 ${
      type === 'success' ? 'bg-[#4ECCA3] text-white' : 'bg-red-500 text-white'
    }`}>
      {type === 'success' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      )}
      <span className="text-sm font-medium">{message}</span>
    </div>
  );
}

type FeedScope = 'all' | 'friends' | 'forYou';

const FEED_SCOPES: { value: FeedScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'friends', label: 'Friends' },
  { value: 'forYou', label: 'For You' },
];

const PAGE_SIZE = 15;

type HomeViewProps = {
  createPostRequestKey?: number;
};

export function HomeView(props: HomeViewProps) {
  const [scope, setScope] = useState<FeedScope>('all');
  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isPublishing, setIsPublishing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const createPostRequestRef = useRef<number>(props.createPostRequestKey ?? 0);
  const postFeedKey = `${scope}-${refreshKey}`;

  const fetchPage = useCallback(
    async (cursorArg: string | null) => {
      const data = await dataSync.loadPostFeed({
        scope,
        limit: PAGE_SIZE,
        cursor: cursorArg ?? undefined,
      });
      return {
        items: data?.items ?? [],
        nextCursor: data?.page?.nextCursor ?? null,
      };
    },
    [scope],
  );

  useEffect(() => {
    const nextKey = props.createPostRequestKey ?? 0;
    if (nextKey === createPostRequestRef.current) {
      return;
    }
    createPostRequestRef.current = nextKey;
    setCreatePostOpen(true);
  }, [props.createPostRequestKey]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center gap-3 bg-white px-6">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-900">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        <h1 className="text-lg font-semibold tracking-tight text-gray-900">Home</h1>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50">
        <div className="mx-auto max-w-2xl px-6 py-6">
          {/* Create Post Prompt */}
          <button
            type="button"
            onClick={() => setCreatePostOpen(true)}
            className="flex w-full items-center gap-3 rounded-[10px] border border-gray-200 bg-white px-4 py-3 text-left transition hover:bg-gray-50"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-cyan-500">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <span className="text-sm text-gray-400">What&apos;s on your mind?</span>
          </button>

          {/* Scope Filter */}
          <div className="mt-4 flex gap-2">
            {FEED_SCOPES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setScope(s.value)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  scope === s.value
                    ? 'bg-cyan-500 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Publishing placeholder - shown at top of feed */}
          {isPublishing && (
            <div className="mt-4">
              <PublishingPostCard />
            </div>
          )}

          {/* Feed */}
          <div className="mt-4">
            <PostFeed
              key={postFeedKey}
              fetchPage={fetchPage}
              emptyText="No posts yet"
              renderItem={(post) => (
                <PostCard
                  post={post}
                  onDelete={() => setRefreshKey((k) => k + 1)}
                />
              )}
            />
          </div>
        </div>
      </div>

      <CreatePostModal
        open={createPostOpen}
        onClose={() => setCreatePostOpen(false)}
        onUploadStart={() => setIsPublishing(true)}
        onCreated={() => {
          setIsPublishing(false);
          setRefreshKey((k) => k + 1);
          setToast({ message: 'Post published successfully!', type: 'success' });
        }}
      />

      {/* Toast notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
