import { useModsPanelModel } from './mods-panel-controller';
import { ModsPanelView } from './mods-panel-view';

export function ModsPanel() {
  const model = useModsPanelModel();
  return <ModsPanelView {...model} />;
}
