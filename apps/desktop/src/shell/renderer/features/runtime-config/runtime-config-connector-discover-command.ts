import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import type { StatusBanner } from '../../app-shell/providers/app-store';
import type { RuntimeConfigStateUpdater } from './runtime-config-types';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import { discoverLocalModelsFromEndpoint } from './runtime-config-connector-discovery';

export async function runDiscoverLocalModelsCommand(input: {
  state: RuntimeConfigStateV11;
  sdk: DesktopRendererSdkPort;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (banner: StatusBanner | null) => void;
}) {
  const {
    endpoint,
    models,
    nodeMatrix,
  } = await discoverLocalModelsFromEndpoint(input.state, input.sdk);

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
