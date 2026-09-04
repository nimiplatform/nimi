import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { LocalModelCenter } from './runtime-config-local-model-center';

export function LocalAssetsPage(props: { readonly model: RuntimeConfigPanelControllerModel }) {
  return <LocalModelCenter runtimeWritesDisabled={props.model.runtimeWritesDisabled} />;
}
