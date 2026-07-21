import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import type { StatusBanner } from '../../app-shell/providers/app-store';
import type { RuntimeConfigStateUpdater } from './runtime-config-types';
import { discoverLocalModelsFromEndpoint } from './runtime-config-connector-discovery';

export async function runDiscoverLocalModelsCommand(input: {
  state: RuntimeConfigStateV11;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (banner: StatusBanner | null) => void;
}) {
  const {
    endpoint,
    models,
    nodeMatrix,
  } = await discoverLocalModelsFromEndpoint(input.state);

  input.updateState((prev) => {
    return {
      ...prev,
      local: {
        ...prev.local,
        endpoint,
        models,
        nodeMatrix,
      },
    };
  });
}
