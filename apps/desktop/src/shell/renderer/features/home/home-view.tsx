import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollArea, Surface, nimiToast } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import type { NimiRealmFeedScope } from '@nimiplatform/sdk/realm';
import { E2E_IDS } from '../../testability/e2e-ids';
import { ProfileDetailModal } from '../relationship/profile-detail-modal.js';
import { CreatePostModal } from '../profile/create-post-modal.js';
import { PostCard, type PostCardAuthorProfileTarget } from './post-card';
import { usePostCardActionAdapter } from './post-card-action-adapter';
import { PostFeed } from './post-feed';
import { HomeCreatePostButton, HomeFeedScopeNav } from './home-feed-controls';
import { prepareHomeFeedItems } from './utils';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';

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

const PAGE_SIZE = 15;
type HomeFeedColumns = 1 | 2;

type HomeViewProps = {
  feedScope: NimiRealmFeedScope;
  onFeedScopeChange: (scope: NimiRealmFeedScope) => void;
};

function resolveHomeFeedColumns(isWide: boolean): HomeFeedColumns {
  return isWide ? 2 : 1;
}

function useHomeFeedColumns(): HomeFeedColumns {
  const bindings = useDesktopRendererBindings();
  const readColumns = () => resolveHomeFeedColumns(bindings.app.projection.viewportWidth() >= 1_280);
  const [columns, setColumns] = useState<HomeFeedColumns>(readColumns);

  useEffect(() => {
    const handleChange = () => setColumns(readColumns());
    handleChange();
    return bindings.app.events.subscribeWindowResize(handleChange);
  }, [bindings]);

  return columns;
}

export function HomeView(props: HomeViewProps) {
  const realmSocialData = useRealmSocialData();
  const { t } = useTranslation();
  const navigateToSourceDetail = useAppStore((state) => state.navigateToSourceDetail);
  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [selectedFeedProfile, setSelectedFeedProfile] = useState<
    Extract<PostCardAuthorProfileTarget, { kind: 'human' }> | null
  >(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isPublishing, setIsPublishing] = useState(false);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  // PostFeed remounts when scope or refreshKey changes so each scope is read
  // fresh through the SDK typed Realm feed projection — no carried-over
  // cross-scope Post state.
  const postFeedKey = `moments-${props.feedScope}-${refreshKey}`;
  const postCardActionAdapter = usePostCardActionAdapter();
  const homeFeedColumns = useHomeFeedColumns();
  const handleOpenAuthorProfile = useCallback((target: PostCardAuthorProfileTarget) => {
    if (target.kind === 'character') {
      navigateToSourceDetail(target.sourceRef);
      return;
    }
    setSelectedFeedProfile(target);
  }, [navigateToSourceDetail]);

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
    [props.feedScope, realmSocialData],
  );

  useEffect(() => {
    const handleBlockedUsersUpdated = () => {
      setRefreshKey((current) => current + 1);
    };
    return realmSocialData.subscribeBlockedUsers(handleBlockedUsersUpdated);
  }, [realmSocialData]);

  return (
    <div
      data-testid={E2E_IDS.panel('home')}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-4"
    >
      <div className={`mx-auto w-full shrink-0 px-1 pb-2 ${homeFeedColumns === 2 ? 'max-w-[1144px]' : 'max-w-[560px]'}`}>
        <div className="flex items-center justify-between">
          <HomeFeedScopeNav active={props.feedScope} onSelect={props.onFeedScopeChange} />
          <HomeCreatePostButton onClick={() => setCreatePostOpen(true)} />
        </div>
      </div>
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
                    onOpenAuthorProfile={handleOpenAuthorProfile}
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
            nimiToast.success(mode === 'edit'
              ? t('Home.postUpdated', { defaultValue: 'Post updated successfully!' })
              : t('Home.postPublished', { defaultValue: 'Post published successfully!' }));
            return;
          }
          nimiToast.danger(mode === 'edit'
            ? t('Home.postUpdateFailed', { defaultValue: 'Failed to update post' })
            : t('Home.postPublishFailed', { defaultValue: 'Failed to publish post' }));
        }}
      />

      <ProfileDetailModal
        open={Boolean(selectedFeedProfile)}
        profileId={selectedFeedProfile?.profileId || ''}
        profileSeed={selectedFeedProfile?.profileSeed || null}
        onClose={() => setSelectedFeedProfile(null)}
      />

    </div>
  );
}
