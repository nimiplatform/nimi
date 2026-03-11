import { useModHubPageModel } from '@renderer/features/mod-hub/mod-hub-controller';
import { ModHubView } from '@renderer/features/mod-hub/mod-hub-view';

export function ModsPanel() {
  const model = useModHubPageModel();
  return <ModHubView {...model} />;
}
