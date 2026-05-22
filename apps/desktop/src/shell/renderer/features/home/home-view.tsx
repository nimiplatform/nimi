import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollArea, Surface } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { BLOCKED_USERS_UPDATED_EVENT, dataSync, type PostFeedScope } from '@runtime/data-sync';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { ContactDetailProfileModal } from '@renderer/features/contacts/contact-detail-profile-modal.js';
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

/**
 * Canonical Realm feed scopes presented on the Home feed surface.
 * Source of truth: `.nimi/spec/desktop/kernel/tables/home-feed-scopes.yaml`
 * (D-HOMEFEED-004) over Realm `R-FEED-005`. Scope membership is server
 * truth; the renderer never infers authorship client-side.
 */
const HOME_FEED_SCOPES: readonly PostFeedScope[] = ['personal', 'friends', 'agent_activity'];
const DEFAULT_HOME_FEED_SCOPE: PostFeedScope = 'friends';

type ScopeSelectorItem = {
  value: PostFeedScope;
  label: string;
  description: string;
};

type HomeViewProps = {
  createPostRequestKey?: number;
};

export function HomeView(props: HomeViewProps) {
  const { t } = useTranslation();
  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [selectedFeedProfile, setSelectedFeedProfile] = useState<PostCardAuthorProfileTarget | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [feedScope, setFeedScope] = useState<PostFeedScope>(DEFAULT_HOME_FEED_SCOPE);
  const [isPublishing, setIsPublishing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const createPostRequestRef = useRef<number>(props.createPostRequestKey ?? 0);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  // PostFeed remounts when scope or refreshKey changes so each scope is read
  // fresh through the SDK typed Realm feed projection — no carried-over
  // cross-scope Post state.
  const postFeedKey = `moments-${feedScope}-${refreshKey}`;
  const postCardActionAdapter = usePostCardActionAdapter();

  const scopeSelectorItems = useMemo<ScopeSelectorItem[]>(
    () =>
      HOME_FEED_SCOPES.map((scope) => ({
        value: scope,
        label: t(`Home.feedScopes.${scope}`),
        description: t(`Home.feedScopeDescriptions.${scope}`),
      })),
    [t],
  );
  const fetchPage = useCallback(
    async (cursorArg: string | null) => {
      const data = await dataSync.loadPostFeed({
        scope: feedScope,
        limit: PAGE_SIZE,
        cursor: cursorArg ?? undefined,
      });
      return {
        items: prepareHomeFeedItems(data?.items ?? []),
        nextCursor: data?.page?.nextCursor ?? null,
      };
    },
    [feedScope],
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
        <div className="mx-auto grid w-full max-w-[1040px] grid-cols-1 gap-6 xl:grid-cols-[minmax(0,720px)_300px]">
          <main className="min-w-0">
            <Surface
              as="button"
              type="button"
              onClick={() => setCreatePostOpen(true)}
              tone="panel"
              material="glass-regular"
              elevation="base"
              padding="none"
              interactive
              className="mb-4 mt-2 flex w-full items-center gap-3 rounded-2xl border-white/65 px-4 py-3 text-left shadow-[0_16px_36px_rgba(15,23,42,0.06)] xl:hidden"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,white)] text-[var(--nimi-action-primary-bg)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </span>
              <span className="text-sm text-[var(--nimi-text-secondary)]">
                {t('Home.composePrompt', { defaultValue: "What's on your mind?" })}
              </span>
            </Surface>

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
                emptyText={t(`Home.feedScopeEmpty.${feedScope}`)}
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

          <aside className="order-first mt-2 xl:order-none">
            <Surface
              tone="panel"
              material="glass-regular"
              elevation="base"
              padding="none"
              className="sticky top-2 overflow-hidden rounded-2xl border border-white/65 shadow-[0_18px_42px_rgba(15,23,42,0.07)]"
            >
              <div className="space-y-2 p-3">
                {scopeSelectorItems.map((item) => {
                  const selected = item.value === feedScope;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setFeedScope(item.value)}
                      className={`group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition ${
                        selected
                          ? 'bg-white/78 shadow-[0_12px_28px_rgba(15,23,42,0.07)] ring-1 ring-white/80'
                          : 'hover:bg-white/50'
                      }`}
                    >
                      <span
                        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                          selected ? 'bg-[var(--nimi-action-primary-bg)]' : 'bg-slate-300 group-hover:bg-slate-400'
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-[color:var(--nimi-text-primary)]">
                          {item.label}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-[color:var(--nimi-text-muted)]">
                          {item.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-white/55 p-3">
                <button
                  type="button"
                  onClick={() => setCreatePostOpen(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--nimi-action-primary-bg)] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(78,204,163,0.22)] transition active:scale-[0.99]"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  {t('Home.createPost', { defaultValue: 'Create Post' })}
                </button>
              </div>
            </Surface>
          </aside>
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

    </div>
  );
}
