import type { NimiRealmFeedScope } from '@nimiplatform/sdk/realm';
import {
  ExploreSearchField,
  ExploreSectionNav,
  type ExploreSectionId,
} from '@renderer/features/explore/explore-section-nav';
import {
  HomeFeedScopeNav,
} from '@renderer/features/home/home-feed-controls';
import type { AppTab } from '@renderer/app-shell/providers/app-store';
import { useTranslation } from 'react-i18next';

type MainLayoutTitlebarContentProps = {
  activeTab: AppTab;
  homeFeedScope: NimiRealmFeedScope;
  onHomeFeedScopeChange: (scope: NimiRealmFeedScope) => void;
  exploreActiveSection: ExploreSectionId;
  onExploreSectionChange: (section: ExploreSectionId) => void;
  exploreSearchText: string;
  onExploreSearchTextChange: (value: string) => void;
};

export function MainLayoutTitlebarContent(props: MainLayoutTitlebarContentProps) {
  const { t } = useTranslation();

  if (props.activeTab === 'home') {
    return (
      <div className="flex min-w-0 items-center gap-3">
        <HomeFeedScopeNav
          active={props.homeFeedScope}
          onSelect={props.onHomeFeedScopeChange}
        />
      </div>
    );
  }

  if (props.activeTab === 'explore') {
    return (
      <div className="flex h-full min-w-0 items-center">
        <ExploreSectionNav
          active={props.exploreActiveSection}
          onSelect={props.onExploreSectionChange}
          variant="topbar"
        />
        <div className="flex min-w-0 flex-1 items-center justify-center px-4">
          <div className="w-full min-w-[260px] max-w-[500px]">
            <ExploreSearchField
              value={props.exploreSearchText}
              onChange={props.onExploreSearchTextChange}
              placeholder={t('Explore.searchPlaceholder', { defaultValue: 'Search agents by name/handle...' })}
            />
          </div>
        </div>
      </div>
    );
  }

  return null;
}
