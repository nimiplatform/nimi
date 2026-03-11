import { useModHubPageModel } from './mod-hub-controller';
import { ModHubView } from './mod-hub-view';

export function ModHubPage() {
  const model = useModHubPageModel();
  return <ModHubView {...model} />;
}
