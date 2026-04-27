import {
  registerInjectedRuntimeMods,
  type RuntimeModRegisterFailure,
} from '@runtime/mod';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { RuntimeModHydrationRecord } from '@renderer/app-shell/providers/store-types';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import {
  attachRuntimeModDeveloperHostSubscriptions,
  reconcileRuntimeLocalMods,
} from '@renderer/mod-ui/lifecycle/runtime-mod-developer-host';

export async function registerBootstrapRuntimeMods(input: {
  flowId: string;
  generation?: string;
  isCurrent?: () => boolean;
}): Promise<{
  runtimeModFailures: RuntimeModRegisterFailure[];
  manifestCount: number;
}> {
  const generation = String(input.generation || 'bootstrap').trim() || 'bootstrap';
  const isCurrent = input.isCurrent ?? (() => true);
  const applyIfCurrent = (task: () => void): void => {
    if (isCurrent()) {
      task();
    }
  };
  const toHydrationUpdatedAt = () => new Date().toISOString();
  logRendererEvent({
    level: 'info',
    area: 'renderer-bootstrap',
    message: 'phase:register-runtime-mods:start',
    flowId: input.flowId,
    details: {
      loadingMode: 'manifest-sideload',
    },
  });

  const runtimeModFailures: RuntimeModRegisterFailure[] = [];
  if (!desktopBridge.hasTauriInvoke()) {
    const errorMessage = 'Desktop mods require Tauri runtime. Start with `pnpm --filter @nimiplatform/desktop run dev:shell`.';
    runtimeModFailures.push({
      modId: 'runtime.tauri-unavailable',
      sourceType: 'sideload',
      stage: 'discover',
      error: errorMessage,
    });
    applyIfCurrent(() => {
      useAppStore.getState().setLocalManifestSummaries([]);
      useAppStore.getState().setRuntimeModFailures(runtimeModFailures);
      useAppStore.getState().setRuntimeModHydrationRecords([{
        modId: 'runtime.tauri-unavailable',
        status: 'failed',
        generation,
        stage: 'discover',
        error: errorMessage,
        updatedAt: toHydrationUpdatedAt(),
      }]);
    });
    logRendererEvent({
      level: 'warn',
      area: 'renderer-bootstrap',
      message: 'phase:register-runtime-mods:tauri-unavailable',
      flowId: input.flowId,
      details: {
        error: errorMessage,
      },
    });
    return {
      runtimeModFailures,
      manifestCount: 0,
    };
  }

  const injectedResult = await registerInjectedRuntimeMods();
  runtimeModFailures.push(...injectedResult.failedMods);

  const { manifests, failures } = await reconcileRuntimeLocalMods();
  const manifestCount = manifests.length;
  runtimeModFailures.push(...failures);
  applyIfCurrent(() => {
    const currentStore = useAppStore.getState();
    currentStore.setRuntimeModFailures([...injectedResult.failedMods, ...failures]);
    const failedById = new Map(runtimeModFailures.map((failure) => [String(failure.modId || '').trim(), failure]));
    const registeredIds = new Set(currentStore.registeredRuntimeModIds.map((modId) => String(modId || '').trim()));
    const hydrationRecords: RuntimeModHydrationRecord[] = manifests.map((manifest) => {
      const modId = String(manifest.id || '').trim();
      const failure = failedById.get(modId);
      if (failure) {
        return {
          modId,
          status: 'failed',
          generation,
          stage: failure.stage,
          error: failure.error,
          updatedAt: toHydrationUpdatedAt(),
        };
      }
      return {
        modId,
        status: registeredIds.has(modId) ? 'hydrated' : 'not_requested',
        generation,
        updatedAt: toHydrationUpdatedAt(),
      };
    });
    currentStore.setRuntimeModHydrationRecords(hydrationRecords);
  });
  void attachRuntimeModDeveloperHostSubscriptions().catch((error) => {
    logRendererEvent({
      level: 'warn',
      area: 'renderer-bootstrap',
      message: 'phase:register-runtime-mods:developer-host-subscriptions-deferred',
      flowId: input.flowId,
      details: {
        error: error instanceof Error ? error.message : String(error || ''),
      },
    });
  });

  if (runtimeModFailures.length > 0) {
    logRendererEvent({
      level: 'warn',
      area: 'renderer-bootstrap',
      message: 'phase:register-runtime-mods:partial-failed',
      flowId: input.flowId,
      details: {
        failureCount: runtimeModFailures.length,
        failures: runtimeModFailures,
      },
    });
  }

  return {
    runtimeModFailures,
    manifestCount,
  };
}
