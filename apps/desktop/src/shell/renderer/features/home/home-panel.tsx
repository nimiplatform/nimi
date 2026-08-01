import type { NimiRealmFeedScope } from '@nimiplatform/sdk/realm';
import { HomeView } from './home-view';

type HomePanelProps = {
  feedScope: NimiRealmFeedScope;
  onFeedScopeChange: (scope: NimiRealmFeedScope) => void;
};

export function HomePanel(props: HomePanelProps) {
  return (
    <HomeView
      feedScope={props.feedScope}
      onFeedScopeChange={props.onFeedScopeChange}
    />
  );
}
