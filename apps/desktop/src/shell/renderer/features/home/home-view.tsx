import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton, ScrollArea, Surface } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { BLOCKED_USERS_UPDATED_EVENT, dataSync } from '@runtime/data-sync';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { ContactDetailProfileModal } from '@renderer/features/contacts/contact-detail-profile-modal.js';
import { CreatePostModal } from '../profile/create-post-modal.js';
import { PostCard, type PostCardAuthorProfileTarget } from './post-card';
import { PostFeed } from './post-feed';
import { prepareHomeFeedItems } from './utils';

// Optimistic post placeholder component
function PublishingPostCard() {
  const { t } = useTranslation();
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
          {t('Home.publishing', { defaultValue: 'Publishing...' })}
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
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onCloseRef.current();
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

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
  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [selectedFeedProfile, setSelectedFeedProfile] = useState<PostCardAuthorProfileTarget | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isPublishing, setIsPublishing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const createPostRequestRef = useRef<number>(props.createPostRequestKey ?? 0);
  const postFeedKey = `moments-${refreshKey}`;

  const fetchPage = useCallback(
    async (cursorArg: string | null) => {
      const data = await dataSync.loadPostFeed({
        limit: PAGE_SIZE,
        cursor: cursorArg ?? undefined,
      });
      return {
        items: prepareHomeFeedItems(data?.items ?? []),
        nextCursor: data?.page?.nextCursor ?? null,
      };
    },
    [],
  );

  useEffect(() => {
    const nextKey = props.createPostRequestKey ?? 0;
    if (nextKey === createPostRequestRef.current) {
      return;
    }
    createPostRequestRef.current = nextKey;
    setCreatePostOpen(true);
  }, [props.createPostRequestKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const handleBlockedUsersUpdated = () => {
      setRefreshKey((current) => current + 1);
    };
    window.addEventListener(BLOCKED_USERS_UPDATED_EVENT, handleBlockedUsersUpdated);
    return () => window.removeEventListener(BLOCKED_USERS_UPDATED_EVENT, handleBlockedUsersUpdated);
  }, []);

  return (
    <div data-testid={E2E_IDS.panel('home')} className="flex min-h-0 flex-1 flex-col">
      {/* Top bar */}
      <Surface tone="canvas" padding="none" className="flex h-14 shrink-0 items-center gap-3 rounded-none border-0 border-b border-slate-200 px-6">
        <h1 className={`nimi-type-page-title text-[color:var(--nimi-text-primary)]`}>{t('Home.pageTitle')}</h1>
      </Surface>

      <ScrollArea
        className="flex-1 bg-gray-50"
        viewportClassName="bg-gray-50"
        contentClassName="mx-auto max-w-2xl px-6 py-0"
      >
          {/* Create Post Prompt */}
          <Surface
            as="button"
            type="button"
            onClick={() => setCreatePostOpen(true)}
            tone="card"
            elevation="base"
            padding="none"
            interactive
            className="mt-4 flex w-full items-center gap-3 rounded-[1.5rem] border border-slate-200 px-4 py-3 text-left"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-cyan-500">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <span className="text-sm text-gray-400">
              {t('Home.composePrompt', { defaultValue: "What's on your mind?" })}
            </span>
          </Surface>

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
              emptyText={t('PostsTab.noPosts', { defaultValue: 'No posts yet' })}
              renderItem={(post) => (
                <PostCard
                  post={post}
                  onDelete={() => setRefreshKey((k) => k + 1)}
                  onBlock={() => setRefreshKey((k) => k + 1)}
                  showAddFriendBadge={false}
                  onOpenAuthorProfile={setSelectedFeedProfile}
                />
              )}
            />
          </div>
      </ScrollArea>

      <CreatePostModal
        open={createPostOpen}
        onClose={() => setCreatePostOpen(false)}
        onUploadStart={() => setIsPublishing(true)}
        onComplete={({ success, mode }) => {
          setIsPublishing(false);
          if (success) {
            setRefreshKey((k) => k + 1);
            setToast({
              message: mode === 'edit'
                ? t('Home.postUpdated', { defaultValue: 'Post updated successfully!' })
                : t('Home.postPublished', { defaultValue: 'Post published successfully!' }),
              type: 'success',
            });
            return;
          }
          setToast({
            message: mode === 'edit'
              ? t('Home.postUpdateFailed', { defaultValue: 'Failed to update post' })
              : t('Home.postPublishFailed', { defaultValue: 'Failed to publish post' }),
            type: 'error',
          });
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
        open={Boolean(selectedFeedProfile)}
        profileId={selectedFeedProfile?.profileId || ''}
        profileSeed={selectedFeedProfile?.profileSeed || null}
        onClose={() => setSelectedFeedProfile(null)}
      />

      {/* Floating Create Post Button */}
      <IconButton
        icon={(
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        )}
        tone="primary"
        onClick={() => setCreatePostOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-12 w-12 shadow-lg shadow-[#4ECCA3]/30 hover:shadow-xl hover:shadow-[#4ECCA3]/40"
        aria-label={t('Home.createPost', { defaultValue: 'Create Post' })}
      />
    </div>
  );
}
