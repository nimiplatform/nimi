import type { NimiRealmFeedScope } from '@nimiplatform/sdk/realm';
import { HomeView } from './home-view';

type HomePanelProps = {
  createPostRequestKey?: number;
  feedScope: NimiRealmFeedScope;
};

export function HomePanel(props: HomePanelProps) {
  return (
    <HomeView
      createPostRequestKey={props.createPostRequestKey}
      feedScope={props.feedScope}
    />
  );
}
