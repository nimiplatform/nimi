import {
  registerInjectedRuntimeMods,
  type RuntimeModRegisterFailure,
} from '@runtime/mod';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { i18n } from '@renderer/i18n';
import { syncRuntimeModShellState } from '@renderer/mod-ui/lifecycle/runtime-mod-shell-state';
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
  await syncRuntimeModShellState(manifests);
  await attachRuntimeModDeveloperHostSubscriptions();

  if (runtimeModFailures.length > 0) {
    const failurePreview = runtimeModFailures
      .slice(0, 3)
      .map((failure) => `${failure.modId}@${failure.stage}:${failure.error}`)
      .join(' | ');
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
    appStore.setStatusBanner({
      kind: 'warning',
      message: i18n.t('ModUI.bootstrapPartialFailure', {
        count: runtimeModFailures.length,
        chain: failurePreview,
        defaultValue: `${runtimeModFailures.length} mods failed to load. Error chain: ${failurePreview}`,
      }),
    });
  }

  return {
    runtimeModFailures,
    manifestCount,
  };
}
