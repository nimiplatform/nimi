import { HomeView } from './home-view';

type HomePanelProps = {
  createPostRequestKey?: number;
};

export function HomePanel(props: HomePanelProps) {
  return <HomeView createPostRequestKey={props.createPostRequestKey} />;
}
