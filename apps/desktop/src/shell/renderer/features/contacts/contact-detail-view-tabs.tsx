import { Suspense, lazy, type MutableRefObject, type RefObject, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProfileTab } from '@renderer/features/profile/profile-model';
import type { ContactDetailViewController } from './contact-detail-view-controller.js';
import { ContactDetailTabFallback } from './contact-detail-view-content-shell.js';

const CONTACT_DETAIL_TABS: ProfileTab[] = ['Posts', 'Collections', 'Likes', 'Gifts'];

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

function getContactDetailTabLabel(t: ReturnType<typeof useTranslation>['t'], tab: ProfileTab): string {
  switch (tab) {
    case 'Posts':
      return t('Profile.tabPosts', { defaultValue: 'Posts' });
    case 'Collections':
      return t('Profile.tabCollections', { defaultValue: 'Collections' });
    case 'Likes':
      return t('Profile.tabLikes', { defaultValue: 'Likes' });
    case 'Gifts':
      return t('Profile.tabGifts', { defaultValue: 'Gifts' });
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
    default:
      return null;
  }

  return (
    <div key={tab} className={activeTab === tab ? 'block' : 'hidden'} data-tab-panel={tab}>
      <Suspense fallback={<ContactDetailTabFallback />}>
        {content}
      </Suspense>
    </div>
  );
}

type ContactDetailTabsProps = {
  activeTab: ProfileTab;
  isBlockedProfile?: boolean;
  isOwnProfile?: boolean;
  onSetActiveTab: (tab: ProfileTab) => void;
  profileId: string;
  tabButtonRefs: MutableRefObject<ContactDetailViewController['tabButtonRefs']['current']>;
  tabIndicator: ContactDetailViewController['tabIndicator'];
  tabListRef: RefObject<HTMLDivElement | null>;
  visitedTabs: ProfileTab[];
};

export function ContactDetailTabs(props: ContactDetailTabsProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="px-4">
        <div
          ref={props.tabListRef}
          className="relative flex flex-wrap gap-6 border-b border-slate-200/70 pb-3"
        >
          {CONTACT_DETAIL_TABS.map((tab) => (
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
                {getContactDetailTabLabel(t, tab)}
              </span>
              <span
                className={`absolute inset-0 flex items-center justify-center text-sm transition-all duration-300 ${
                  props.activeTab === tab
                    ? 'text-[15px] font-semibold text-slate-950'
                    : 'font-normal text-slate-500 hover:text-slate-800'
                }`}
              >
                {getContactDetailTabLabel(t, tab)}
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
      <div className="px-5 py-5">
        {CONTACT_DETAIL_TABS.map((tab) => (
          renderTabPanel(props.activeTab, Boolean(props.isBlockedProfile), props.profileId, tab, props.visitedTabs)
        ))}
      </div>
    </>
  );
}
