import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import { ContactDetailProfileModal } from '@renderer/features/contacts/contact-detail-profile-modal.js';
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

const PAGE_SIZE = 15;

type HomeViewProps = {
  createPostRequestKey?: number;
};

export function HomeView(props: HomeViewProps) {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUserId = String(useAppStore((state) => state.auth.user?.id || '')).trim();
  const selectedProfileId = useAppStore((state) => state.selectedProfileId);
  const selectedProfileIsAgent = useAppStore((state) => state.selectedProfileIsAgent);
  const setSelectedProfileId = useAppStore((state) => state.setSelectedProfileId);
  const setSelectedProfileIsAgent = useAppStore((state) => state.setSelectedProfileIsAgent);
  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isPublishing, setIsPublishing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const createPostRequestRef = useRef<number>(props.createPostRequestKey ?? 0);
  const postFeedKey = `moments-${refreshKey}`;

  const contactsQuery = useQuery({
    queryKey: ['contacts', authStatus],
    queryFn: async () => {
      const snapshot = await dataSync.loadSocialSnapshot();
      return snapshot as {
        friends?: Array<Record<string, unknown>>;
      };
    },
    enabled: authStatus === 'authenticated',
  });

  const allowedAuthorIds = useMemo(() => {
    const ids = new Set<string>();
    if (currentUserId) {
      ids.add(currentUserId);
    }
    for (const friend of contactsQuery.data?.friends || []) {
      const friendId = String(friend.id || '').trim();
      if (friendId) {
        ids.add(friendId);
      }
    }
    return ids;
  }, [contactsQuery.data?.friends, currentUserId]);

  const fetchPage = useCallback(
    async (cursorArg: string | null) => {
      const data = await dataSync.loadPostFeed({
        scope: 'friends',
        limit: PAGE_SIZE,
        cursor: cursorArg ?? undefined,
      });
      const items = (data?.items ?? []).filter((item) => {
        const authorId = String(item.author?.id || '').trim();
        return authorId ? allowedAuthorIds.has(authorId) : false;
      }).sort((left, right) => {
        const leftTime = Date.parse(String(left.createdAt ?? ''));
        const rightTime = Date.parse(String(right.createdAt ?? ''));
        return rightTime - leftTime;
      });
      return {
        items,
        nextCursor: data?.page?.nextCursor ?? null,
      };
    },
    [allowedAuthorIds],
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
      <div className="flex h-14 shrink-0 items-center gap-3 bg-gray-50 px-6">
        <h1 className={APP_PAGE_TITLE_CLASS}>{t('Home.pageTitle')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50">
        <div className="mx-auto max-w-2xl px-6 py-0">
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
                  showAddFriendBadge={false}
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

      <ContactDetailProfileModal
        open={Boolean(selectedProfileId)}
        profileId={selectedProfileId || ''}
        profileSeed={selectedProfileId ? {
          id: selectedProfileId,
          displayName: '',
          handle: '',
          isAgent: selectedProfileIsAgent === true,
        } : null}
        onClose={() => {
          setSelectedProfileId(null);
          setSelectedProfileIsAgent(null);
        }}
      />

      {/* Floating Create Post Button */}
      <button
        type="button"
        onClick={() => setCreatePostOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-[#4ECCA3] text-white shadow-lg shadow-[#4ECCA3]/30 transition-all duration-200 hover:scale-110 hover:shadow-xl hover:shadow-[#4ECCA3]/40 active:scale-95"
        aria-label="Create Post"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
