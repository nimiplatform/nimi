import { useCallback, useEffect, useRef, useState } from 'react';
import { dataSync } from '@runtime/data-sync';
import { CreatePostModal } from '../profile/components/create-post-modal';
import { PostCard } from './post-card';
import { PostFeed } from './post-feed';

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
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-6">
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

          {/* Feed */}
          <div className="mt-4">
            <PostFeed
              key={postFeedKey}
              fetchPage={fetchPage}
              emptyText="No posts yet"
              renderItem={(post) => <PostCard post={post} />}
            />
          </div>
        </div>
      </div>

      <CreatePostModal
        open={createPostOpen}
        onClose={() => setCreatePostOpen(false)}
        onCreated={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
