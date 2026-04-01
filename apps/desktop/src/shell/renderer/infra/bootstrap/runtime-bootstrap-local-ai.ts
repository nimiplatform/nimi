import {
  localRuntime,
  type LocalRuntimeAssetRecord,
} from '@runtime/local-runtime';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { safeErrorMessage } from './runtime-bootstrap-utils';

type GoRuntimeSyncResult = {
  action: 'install' | 'start' | 'stop' | 'remove' | 'reconcile';
  modelId: string;
  engine: string;
  localModelId: string;
  status: LocalRuntimeAssetRecord['status'];
  matchedBy: 'install' | 'localModelId' | 'modelId+engine';
};

type GoRuntimeBootstrapResult = {
  reconciled: GoRuntimeSyncResult[];
  adopted: LocalRuntimeAssetRecord[];
};

type BootstrapLocalRuntimeDeps = {
  listDesktopModels: () => Promise<LocalRuntimeAssetRecord[]>;
  reconcileModels: (models: LocalRuntimeAssetRecord[]) => Promise<GoRuntimeBootstrapResult>;
  log: typeof logRendererEvent;
};

function defaultDeps(): BootstrapLocalRuntimeDeps {
  return {
    listDesktopModels: () => localRuntime.listAssets(),
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
