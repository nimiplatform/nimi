import type { PostFeedScope } from '@runtime/data-sync';
import { HomeView } from './home-view';

type HomePanelProps = {
  createPostRequestKey?: number;
  feedScope: PostFeedScope;
};

export function HomePanel(props: HomePanelProps) {
  return (
    <HomeView
      createPostRequestKey={props.createPostRequestKey}
      feedScope={props.feedScope}
    />
  );
}
