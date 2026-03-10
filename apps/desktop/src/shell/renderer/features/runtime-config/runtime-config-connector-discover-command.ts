import { ReasonCode } from '@nimiplatform/sdk/types';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { StatusBanner } from '@renderer/app-shell/providers/app-store';
import type { RuntimeConfigStateUpdater } from './runtime-config-types';
import { getOfflineCacheManager } from '@runtime/offline';
import { discoverLocalModelsFromEndpoint } from './runtime-config-connector-discovery';
import { localAiRuntime, reconcileModelsToGoRuntime } from '@runtime/local-ai-runtime';

export async function runDiscoverLocalModelsCommand(input: {
  state: RuntimeConfigStateV11;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (banner: StatusBanner | null) => void;
}) {
  const {
    endpoint,
    discovered,
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

  // Reconcile Tauri model state → Go runtime to fix registry divergence
  try {
    const fullModels = await localAiRuntime.list();
    await (await getOfflineCacheManager()).syncModelManifests(
      fullModels as unknown as Record<string, unknown>[],
    );
    await reconcileModelsToGoRuntime(fullModels);
  } catch (error) {
    await localAiRuntime.appendAudit({
      eventType: 'runtime_model_sync_failed_during_discovery',
      modelId: 'local-models',
      source: 'local',
      reasonCode: ReasonCode.GO_RUNTIME_SYNC_FAILED,
      detail: error instanceof Error ? error.message : String(error || 'unknown sync error'),
      payload: {
        action: 'runtime_model_sync_failed_during_discovery',
      },
    }).catch(() => null);
    input.setStatusBanner({
      kind: 'warning',
      message: `Discovered local models, but Go runtime reconciliation failed: ${error instanceof Error ? error.message : String(error || '')}`,
    });
    return;
  }

  input.setStatusBanner({
    kind: 'success',
    message: discovered.length > 0
      ? `Discovered ${discovered.length} Local Runtime models`
      : 'Local Runtime model list is up to date',
  });
}
