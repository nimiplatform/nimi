import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollArea, Surface } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import type { NimiRealmFeedScope } from '@nimiplatform/sdk/realm';
import { BLOCKED_USERS_UPDATED_EVENT } from '@renderer/features/social/data/blocked-content';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { ProfileDetailModal } from '@renderer/features/relationship/profile-detail-modal.js';
import { CreatePostModal } from '../profile/create-post-modal.js';
import { PostCard, type PostCardAuthorProfileTarget } from './post-card';
import { usePostCardActionAdapter } from './post-card-action-adapter';
import { PostFeed } from './post-feed';
import { prepareHomeFeedItems } from './utils';

// Optimistic post placeholder component
function PublishingPostCard() {
  const { t } = useTranslation();
  return (
    <Surface
      tone="panel"
      material="glass-regular"
      padding="none"
      className="mb-6 rounded-[2rem] border-white/60 px-5 py-5 opacity-90 shadow-[0_18px_44px_rgba(15,23,42,0.08)]"
    >
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,white)]" />
        <div className="space-y-1">
          <div className="h-4 w-24 animate-pulse rounded bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,white)]" />
          <div className="h-3 w-16 animate-pulse rounded bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,white)]" />
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-[var(--nimi-action-primary-bg)]">
          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
          </svg>
          {t('Home.publishing', { defaultValue: 'Publishing...' })}
        </span>
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,white)]" />
        <div className="h-4 w-[90%] animate-pulse rounded bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,white)]" />
      </div>
      <div className="mt-4 h-[200px] w-full animate-pulse rounded-2xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,white)]" />
    </Surface>
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
      type === 'success' ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]' : 'bg-red-500 text-white'
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
const HOME_FEED_WIDE_MEDIA_QUERY = '(min-width: 1280px)';

type HomeFeedColumns = 1 | 2;

type HomeViewProps = {
  createPostRequestKey?: number;
  feedScope: NimiRealmFeedScope;
};

function resolveHomeFeedColumns(isWide: boolean): HomeFeedColumns {
  return isWide ? 2 : 1;
}

function readHomeFeedColumns(): HomeFeedColumns {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 1;
  }
  return resolveHomeFeedColumns(window.matchMedia(HOME_FEED_WIDE_MEDIA_QUERY).matches);
}

function useHomeFeedColumns(): HomeFeedColumns {
  const [columns, setColumns] = useState<HomeFeedColumns>(readHomeFeedColumns);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(HOME_FEED_WIDE_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setColumns(resolveHomeFeedColumns(event.matches));
    };

    setColumns(resolveHomeFeedColumns(mediaQuery.matches));
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return columns;
}

export function HomeView(props: HomeViewProps) {
  const { t } = useTranslation();
  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [selectedFeedProfile, setSelectedFeedProfile] = useState<PostCardAuthorProfileTarget | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isPublishing, setIsPublishing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const createPostRequestRef = useRef<number>(props.createPostRequestKey ?? 0);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  // PostFeed remounts when scope or refreshKey changes so each scope is read
  // fresh through the SDK typed Realm feed projection — no carried-over
  // cross-scope Post state.
  const postFeedKey = `moments-${props.feedScope}-${refreshKey}`;
  const postCardActionAdapter = usePostCardActionAdapter();
  const homeFeedColumns = useHomeFeedColumns();

  const fetchPage = useCallback(
    async (cursorArg: string | null) => {
      const data = await realmSocialData.loadPostFeed({
        scope: props.feedScope,
        limit: PAGE_SIZE,
        cursor: cursorArg ?? undefined,
      });
      return {
        items: prepareHomeFeedItems(data?.items ?? []),
        nextCursor: data?.page?.nextCursor ?? null,
      };
    },
    [props.feedScope],
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
    <div
      data-testid={E2E_IDS.panel('home')}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-4"
    >
      <ScrollArea
        className="flex-1"
        viewportClassName="bg-transparent"
        contentClassName="w-full px-1 py-4"
        viewportRef={feedScrollRef}
      >
        <div className={homeFeedColumns === 2 ? 'mx-auto w-full max-w-[1144px]' : 'mx-auto w-full max-w-[560px]'}>
          <main className="min-w-0">
            {/* Publishing placeholder - shown at top of feed */}
            {isPublishing && (
              <div className="mt-2">
                <PublishingPostCard />
              </div>
            )}

            {/* Feed */}
            <div className="mt-2">
              <PostFeed
                key={postFeedKey}
                fetchPage={fetchPage}
                scrollRef={feedScrollRef}
                columns={homeFeedColumns}
                emptyText={t(`Home.feedScopeEmpty.${props.feedScope}`)}
                renderItem={(post) => (
                  <PostCard
                    post={post}
                    actionAdapter={postCardActionAdapter}
                    onDelete={() => setRefreshKey((k) => k + 1)}
                    onBlock={() => setRefreshKey((k) => k + 1)}
                    showAddFriendBadge={false}
                    onOpenAuthorProfile={setSelectedFeedProfile}
                  />
                )}
              />
            </div>
          </main>
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

      <ProfileDetailModal
        open={Boolean(selectedFeedProfile)}
        profileId={selectedFeedProfile?.profileId || ''}
        profileSeed={selectedFeedProfile?.profileSeed || null}
        onClose={() => setSelectedFeedProfile(null)}
      />

    </div>
  );
}
