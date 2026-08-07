import {
  createNimiRuntimeLocalAssetAdminClient,
  type NimiRuntimeLocalAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { getDesktopLocalAssetAdminClient } from '../sdk/desktop-nimi-client-session';
import { safeErrorMessage } from './runtime-bootstrap-utils';

type GoRuntimeSyncResult = {
  action: 'install' | 'start' | 'stop' | 'remove' | 'reconcile';
  modelId: string;
  engine: string;
  localModelId: string;
  status: NimiRuntimeLocalAssetRecord['status'];
  matchedBy: 'install' | 'localModelId' | 'modelId+engine';
};

type GoRuntimeBootstrapResult = {
  reconciled: GoRuntimeSyncResult[];
  adopted: NimiRuntimeLocalAssetRecord[];
};

type BootstrapLocalRuntimeDeps = {
  listDesktopModels: () => Promise<readonly NimiRuntimeLocalAssetRecord[]>;
  reconcileModels: (models: readonly NimiRuntimeLocalAssetRecord[]) => Promise<GoRuntimeBootstrapResult>;
  log: typeof logRendererEvent;
};

const runtimeBootstrapLocalAssetAdminClient = createNimiRuntimeLocalAssetAdminClient({
  local: getDesktopLocalAssetAdminClient,
});

function defaultDeps(): BootstrapLocalRuntimeDeps {
  return {
    listDesktopModels: () => runtimeBootstrapLocalAssetAdminClient.listAssets(),
    reconcileModels: async (_models) => ({
      reconciled: [],
      adopted: [],
    }),
    log: logRendererEvent,
  };
}

export async function reconcileLocalRuntimeBootstrapState(input: {
  flowId?: string;
  deps?: Partial<BootstrapLocalRuntimeDeps>;
} = {}): Promise<GoRuntimeBootstrapResult> {
  const deps: BootstrapLocalRuntimeDeps = {
    ...defaultDeps(),
    ...(input.deps || {}),
  };
  try {
    const desktopModels = await deps.listDesktopModels();
    const result = await deps.reconcileModels(Array.isArray(desktopModels) ? desktopModels : []);
    if (result.reconciled.length > 0 || result.adopted.length > 0) {
      deps.log({
        level: 'info',
        area: 'renderer-bootstrap',
        message: 'phase:local-reconcile:done',
        flowId: input.flowId,
        details: {
          reconciledCount: result.reconciled.length,
          adoptedCount: result.adopted.length,
        },
      });
    }
    return result;
  } catch (error) {
    deps.log({
      level: 'warn',
      area: 'renderer-bootstrap',
      message: 'phase:local-reconcile:failed',
      flowId: input.flowId,
      details: {
        error: safeErrorMessage(error),
      },
    });
    return {
      reconciled: [],
      adopted: [],
    };
  }
}
