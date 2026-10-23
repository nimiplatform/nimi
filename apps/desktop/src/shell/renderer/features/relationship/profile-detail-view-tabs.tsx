import { Suspense, lazy, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NimiTabs } from '@nimiplatform/kit/ui';
import type { HumanProfileTab } from '../profile/profile-model';
import { ProfileDetailTabFallback } from './profile-detail-view-content-shell.js';

const PROFILE_DETAIL_TABS: HumanProfileTab[] = ['Collections'];
const OWN_PROFILE_DETAIL_TABS: HumanProfileTab[] = ['Collections', 'FollowedWorlds'];

const CollectionsTab = lazy(async () => {
  const module = await import('../profile/collections-tab');
  return { default: module.CollectionsTab };
});
const FollowedWorldsTab = lazy(async () => {
  const module = await import('../profile/followed-worlds-tab');
  return { default: module.FollowedWorldsTab };
});

function getProfileDetailTabLabel(t: ReturnType<typeof useTranslation>['t'], tab: HumanProfileTab): string {
  switch (tab) {
    case 'Collections':
      return t('Profile.tabCollections', { defaultValue: 'Collections' });
    case 'FollowedWorlds':
      return t('Profile.tabFollowedWorlds', { defaultValue: 'Followed worlds' });
  }
}

function renderTabPanel(
  activeTab: HumanProfileTab,
  isBlockedProfile: boolean,
  profileId: string,
  tab: HumanProfileTab,
  visitedTabs: HumanProfileTab[],
) {
  if (!visitedTabs.includes(tab)) {
    return null;
  }

  let content: ReactNode;
  switch (tab) {
    case 'Collections':
      content = <CollectionsTab profileId={profileId} layout="grid" />;
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
  activeTab: HumanProfileTab;
  isBlockedProfile?: boolean;
  isOwnProfile?: boolean;
  onSetActiveTab: (tab: HumanProfileTab) => void;
  profileId: string;
  visitedTabs: HumanProfileTab[];
};

export function ProfileDetailTabs(props: ProfileDetailTabsProps) {
  const { t } = useTranslation();
  const tabs = props.isOwnProfile ? OWN_PROFILE_DETAIL_TABS : PROFILE_DETAIL_TABS;

  return (
    <>
      <NimiTabs
        className="mx-1"
        items={tabs.map((tab) => ({ value: tab, label: getProfileDetailTabLabel(t, tab) }))}
        value={props.activeTab}
        onValueChange={(value) => props.onSetActiveTab(value as HumanProfileTab)}
        ariaLabel={t('Profile.tabsLabel', { defaultValue: 'Profile tabs' })}
      />
      <div className="px-1 pt-4">
        {tabs.map((tab) => (
          renderTabPanel(props.activeTab, Boolean(props.isBlockedProfile), props.profileId, tab, props.visitedTabs)
        ))}
      </div>
    </>
  );
}
