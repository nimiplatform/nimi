import type { RealmFeedScope } from '@nimiplatform/sdk/realm';
import { HomeView } from './home-view';

type HomePanelProps = {
  createPostRequestKey?: number;
  feedScope: RealmFeedScope;
};

export function HomePanel(props: HomePanelProps) {
  return (
    <HomeView
      createPostRequestKey={props.createPostRequestKey}
      feedScope={props.feedScope}
    />
  );
}
