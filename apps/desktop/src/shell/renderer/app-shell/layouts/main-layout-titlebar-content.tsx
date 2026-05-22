import type { PostFeedScope } from '@runtime/data-sync';
import {
  ExploreSearchField,
  ExploreSectionNav,
  type ExploreSectionId,
} from '@renderer/features/explore/explore-section-nav';
import {
  HomeCreatePostButton,
  HomeFeedScopeNav,
} from '@renderer/features/home/home-feed-controls';
import type { AppTab } from '@renderer/app-shell/providers/app-store';
import { useTranslation } from 'react-i18next';

type MainLayoutTitlebarContentProps = {
  activeTab: AppTab;
  homeFeedScope: PostFeedScope;
  onHomeFeedScopeChange: (scope: PostFeedScope) => void;
  onCreatePostRequest: () => void;
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
        <HomeCreatePostButton onClick={props.onCreatePostRequest} />
      </div>
    );
  }

  if (props.activeTab === 'explore') {
    return (
      <div className="flex min-w-0 items-center gap-5">
        <ExploreSectionNav
          active={props.exploreActiveSection}
          onSelect={props.onExploreSectionChange}
          variant="topbar"
        />
        <div className="ml-auto w-[min(32vw,500px)] min-w-[280px]">
          <ExploreSearchField
            value={props.exploreSearchText}
            onChange={props.onExploreSearchTextChange}
            placeholder={t('Explore.searchPlaceholder', { defaultValue: 'Search agents by name/handle...' })}
          />
        </div>
      </div>
    );
  }

  return null;
}
