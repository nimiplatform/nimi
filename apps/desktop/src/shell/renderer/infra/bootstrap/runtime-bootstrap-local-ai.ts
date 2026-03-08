import {
  localAiRuntime,
  reconcileDesktopAndGoRuntimeModels,
  type GoRuntimeBootstrapResult,
  type LocalAiModelRecord,
} from '@runtime/local-ai-runtime';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { safeErrorMessage } from './runtime-bootstrap-utils';

type BootstrapLocalAiDeps = {
  listDesktopModels: () => Promise<LocalAiModelRecord[]>;
  reconcileModels: (models: LocalAiModelRecord[]) => Promise<GoRuntimeBootstrapResult>;
  log: typeof logRendererEvent;
};

function defaultDeps(): BootstrapLocalAiDeps {
  return {
    listDesktopModels: () => localAiRuntime.list(),
    reconcileModels: (models) => reconcileDesktopAndGoRuntimeModels(models),
    log: logRendererEvent,
  };
}

export async function reconcileLocalAiRuntimeBootstrapState(input: {
  flowId?: string;
  deps?: Partial<BootstrapLocalAiDeps>;
} = {}): Promise<GoRuntimeBootstrapResult> {
  const deps: BootstrapLocalAiDeps = {
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
