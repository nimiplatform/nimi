import {
  registerInjectedRuntimeMods,
  type RuntimeModRegisterFailure,
} from '@runtime/mod';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import {
  attachRuntimeModDeveloperHostSubscriptions,
  reconcileRuntimeLocalMods,
} from '@renderer/mod-ui/lifecycle/runtime-mod-developer-host';

export async function registerBootstrapRuntimeMods(input: {
  flowId: string;
}): Promise<{
  runtimeModFailures: RuntimeModRegisterFailure[];
  manifestCount: number;
}> {
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
    useAppStore.getState().setLocalManifestSummaries([]);
    useAppStore.getState().setRuntimeModFailures(runtimeModFailures);
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

  const appStore = useAppStore.getState();
  const { manifests, failures } = await reconcileRuntimeLocalMods();
  const manifestCount = manifests.length;
  runtimeModFailures.push(...failures);
  appStore.setRuntimeModFailures([...injectedResult.failedMods, ...failures]);
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
