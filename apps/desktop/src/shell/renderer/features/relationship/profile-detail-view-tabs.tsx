import { Suspense, lazy, type MutableRefObject, type RefObject, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProfileTab } from '@renderer/features/profile/profile-model';
import type { ProfileDetailViewController } from './profile-detail-view-controller.js';
import { ProfileDetailTabFallback } from './profile-detail-view-content-shell.js';

const PROFILE_DETAIL_TABS: ProfileTab[] = ['Posts', 'Collections', 'Likes', 'Gifts'];
const OWN_PROFILE_DETAIL_TABS: ProfileTab[] = ['Posts', 'Collections', 'Likes', 'Gifts', 'FollowedWorlds'];

const PostsTab = lazy(async () => {
  const module = await import('@renderer/features/profile/posts-tab');
  return { default: module.PostsTab };
});
const CollectionsTab = lazy(async () => {
  const module = await import('@renderer/features/profile/collections-tab');
  return { default: module.CollectionsTab };
});
const LikesTab = lazy(async () => {
  const module = await import('@renderer/features/profile/likes-tab');
  return { default: module.LikesTab };
});
const GiftsTab = lazy(async () => {
  const module = await import('@renderer/features/profile/gifts-tab');
  return { default: module.GiftsTab };
});
const FollowedWorldsTab = lazy(async () => {
  const module = await import('@renderer/features/profile/followed-worlds-tab');
  return { default: module.FollowedWorldsTab };
});

function getProfileDetailTabLabel(t: ReturnType<typeof useTranslation>['t'], tab: ProfileTab): string {
  switch (tab) {
    case 'Posts':
      return t('Profile.tabPosts', { defaultValue: 'Posts' });
    case 'Collections':
      return t('Profile.tabCollections', { defaultValue: 'Collections' });
    case 'Likes':
      return t('Profile.tabLikes', { defaultValue: 'Likes' });
    case 'Gifts':
      return t('Profile.tabGifts', { defaultValue: 'Gifts' });
    case 'FollowedWorlds':
      return t('Profile.tabFollowedWorlds', { defaultValue: 'Followed worlds' });
  }
}

function renderTabPanel(
  activeTab: ProfileTab,
  isBlockedProfile: boolean,
  profileId: string,
  tab: ProfileTab,
  visitedTabs: ProfileTab[],
) {
  if (!visitedTabs.includes(tab)) {
    return null;
  }

  let content: ReactNode;
  switch (tab) {
    case 'Posts':
      content = <PostsTab profileId={profileId} layout="grid" blockedContent={isBlockedProfile} />;
      break;
    case 'Collections':
      content = <CollectionsTab profileId={profileId} layout="grid" />;
      break;
    case 'Likes':
      content = <LikesTab profileId={profileId} layout="grid" />;
      break;
    case 'Gifts':
      content = <GiftsTab />;
      break;
    case 'FollowedWorlds':
      content = <FollowedWorldsTab />;
      break;
    default:
      return null;
  }

  return (
    <div key={tab} className={activeTab === tab ? 'block' : 'hidden'} data-tab-panel={tab}>
      <Suspense fallback={<ProfileDetailTabFallback />}>
        {content}
      </Suspense>
    </div>
  );
}

type ProfileDetailTabsProps = {
  activeTab: ProfileTab;
  isBlockedProfile?: boolean;
  isOwnProfile?: boolean;
  onSetActiveTab: (tab: ProfileTab) => void;
  profileId: string;
  tabButtonRefs: MutableRefObject<ProfileDetailViewController['tabButtonRefs']['current']>;
  tabIndicator: ProfileDetailViewController['tabIndicator'];
  tabListRef: RefObject<HTMLDivElement | null>;
  visitedTabs: ProfileTab[];
};

export function ProfileDetailTabs(props: ProfileDetailTabsProps) {
  const { t } = useTranslation();
  const tabs = props.isOwnProfile ? OWN_PROFILE_DETAIL_TABS : PROFILE_DETAIL_TABS;

  return (
    <>
      <div className="px-1">
        <div
          ref={props.tabListRef}
          className="relative flex flex-wrap gap-6 border-b border-slate-200/70 pb-2"
        >
          {tabs.map((tab) => (
            <button
              key={tab}
              ref={(node) => {
                props.tabButtonRefs.current[tab] = node;
              }}
              type="button"
              onClick={() => props.onSetActiveTab(tab)}
              className="relative px-0 py-2 transition-all duration-300"
            >
              <span className="invisible block text-[15px] font-semibold">
                {getProfileDetailTabLabel(t, tab)}
              </span>
              <span
                className={`absolute inset-0 flex items-center justify-center text-sm transition-all duration-300 ${
                  props.activeTab === tab
                    ? 'text-[15px] font-semibold text-slate-950'
                    : 'font-normal text-slate-500 hover:text-slate-800'
                }`}
              >
                {getProfileDetailTabLabel(t, tab)}
              </span>
            </button>
          ))}
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-0 h-[3px] rounded-full bg-[linear-gradient(90deg,#49c9a5_0%,#1f9bab_100%)] shadow-[0_1px_8px_rgba(73,201,165,0.24)] transition-[left,width] duration-300 ease-out"
            style={{ left: `${props.tabIndicator.left}px`, width: `${props.tabIndicator.width}px` }}
          />
        </div>
      </div>
      <div className="px-1 pt-4">
        {tabs.map((tab) => (
          renderTabPanel(props.activeTab, Boolean(props.isBlockedProfile), props.profileId, tab, props.visitedTabs)
        ))}
      </div>
    </>
  );
}
