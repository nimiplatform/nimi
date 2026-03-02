import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/types';
import type { StatusBanner } from '@renderer/app-shell/providers/app-store';
import type { RuntimeConfigStateUpdater } from '../../runtime-config-types';
import { discoverLocalRuntimeModelsFromEndpoint } from './discovery';

export async function runDiscoverLocalRuntimeModelsCommand(input: {
  state: RuntimeConfigStateV11;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (banner: StatusBanner | null) => void;
}) {
  const {
    endpoint,
    discovered,
    models,
    nodeMatrix,
  } = await discoverLocalRuntimeModelsFromEndpoint(input.state);

  input.updateState((prev) => {
    return {
      ...prev,
      localRuntime: {
        ...prev.localRuntime,
        endpoint,
        models,
        nodeMatrix,
      },
    };
  });

  input.setStatusBanner({
    kind: 'success',
    message: discovered.length > 0
      ? `Discovered ${discovered.length} Local Runtime models`
      : 'Local Runtime model list is up to date',
  });
}
