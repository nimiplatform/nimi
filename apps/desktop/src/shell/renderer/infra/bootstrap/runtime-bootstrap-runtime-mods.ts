import {
  discoverSideloadRuntimeMods,
  listRegisteredRuntimeModIds,
  registerInjectedRuntimeMods,
  registerRuntimeMods,
  type RuntimeModRegisterFailure,
} from '@runtime/mod';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { syncRuntimeUiExtensionsToRegistry } from '@renderer/mod-ui/lifecycle/sync-runtime-extensions';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { safeErrorMessage } from './runtime-bootstrap-utils';
import { i18n } from '@renderer/i18n';

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
  const sideloadDiscoverFailures: RuntimeModRegisterFailure[] = [];
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
  const disabledModIds = new Set(appStore.runtimeModDisabledIds);
  const uninstalledModIds = new Set(appStore.runtimeModUninstalledIds);
  let manifests: Awaited<ReturnType<typeof desktopBridge.listRuntimeLocalModManifests>> = [];
  try {
    manifests = await desktopBridge.listRuntimeLocalModManifests();
  } catch (error) {
    const errorMessage = safeErrorMessage(error);
    runtimeModFailures.push({
      modId: 'runtime.local-manifest-scan',
      sourceType: 'sideload',
      stage: 'discover',
      error: errorMessage,
    });
    logRendererEvent({
      level: 'warn',
      area: 'renderer-bootstrap',
      message: 'phase:register-runtime-mods:manifest-scan-failed',
      flowId: input.flowId,
      details: {
        error: errorMessage,
      },
    });
  }
  const manifestCount = manifests.length;
  appStore.setLocalManifestSummaries(manifests);
  const eligibleManifests = manifests.filter((manifest) => {
    const modId = String(manifest?.id || '').trim();
    if (!modId) return false;
    if (disabledModIds.has(modId)) return false;
    if (uninstalledModIds.has(modId)) return false;
    return true;
  });

  if (eligibleManifests.length > 0) {
    logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:register-sideload-runtime-mods:start',
      flowId: input.flowId,
      details: {
        manifestCount: manifests.length,
        eligibleManifestCount: eligibleManifests.length,
        disabledCount: disabledModIds.size,
        uninstalledCount: uninstalledModIds.size,
      },
    });

    const sideloadRegistrations = await discoverSideloadRuntimeMods({
      manifests: eligibleManifests,
      readEntry: (entryPath) => desktopBridge.readRuntimeLocalModEntry(entryPath),
      onError: ({ manifestId, entryPath, error }) => {
        const errorMessage = safeErrorMessage(error);
        sideloadDiscoverFailures.push({
          modId: manifestId,
          sourceType: 'sideload',
          stage: 'discover',
          error: errorMessage,
        });
        logRendererEvent({
          level: 'warn',
          area: 'renderer-bootstrap',
          message: 'phase:register-sideload-runtime-mods:item-failed',
          flowId: input.flowId,
          details: {
            manifestId,
            entryPath: entryPath || null,
            error: errorMessage,
          },
        });
      },
    });

      if (sideloadRegistrations.length > 0) {
        const sideloadResult = await registerRuntimeMods(sideloadRegistrations, {
          replaceExisting: true,
        });
        runtimeModFailures.push(...sideloadResult.failedMods);
      }

    logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:register-sideload-runtime-mods:done',
      flowId: input.flowId,
      details: {
        manifestCount: manifests.length,
        eligibleManifestCount: eligibleManifests.length,
        registrationCount: sideloadRegistrations.length,
      },
    });
  }
  runtimeModFailures.push(...sideloadDiscoverFailures);

  appStore.setRuntimeModFailures(runtimeModFailures);
  appStore.setRegisteredRuntimeModIds(listRegisteredRuntimeModIds());
  syncRuntimeUiExtensionsToRegistry();

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
