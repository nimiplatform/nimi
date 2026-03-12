import type { RuntimeLocalManifestSummary } from '@renderer/bridge';
import { desktopBridge } from '@renderer/bridge';
import type { StatusBanner } from '@renderer/app-shell/providers/app-store';
import {
  discoverSideloadRuntimeMods,
  registerInjectedRuntimeMods,
  registerRuntimeMods,
  type RuntimeModRegisterFailure,
} from '@runtime/mod';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import type { UiExtensionContext } from '@renderer/mod-ui/contracts';
import { i18n } from '@renderer/i18n';
import { syncSingleRuntimeModShellState } from '@renderer/mod-ui/lifecycle/runtime-mod-shell-state';

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

type RetryRuntimeModInput = {
  modId: string;
  context: UiExtensionContext;
  localManifestSummaries: RuntimeLocalManifestSummary[];
  runtimeModDisabledIds: string[];
  runtimeModUninstalledIds: string[];
  setRuntimeModFailures: (failures: RuntimeModRegisterFailure[]) => void;
  setStatusBanner: (banner: StatusBanner) => void;
};

export async function retryRuntimeMod(input: RetryRuntimeModInput): Promise<void> {
  const normalizedModId = String(input.modId || '').trim();
  if (!normalizedModId) {
    return;
  }
  if (input.runtimeModDisabledIds.includes(normalizedModId)) {
    input.setStatusBanner({
        kind: 'warning',
        message: i18n.t('ModUI.retryBlockedDisabled', {
          modId: normalizedModId,
          defaultValue: `Mod ${normalizedModId} is disabled. Enable it in Mod Hub before retrying.`,
        }),
    });
    return;
  }
  if (input.runtimeModUninstalledIds.includes(normalizedModId)) {
    input.setStatusBanner({
        kind: 'warning',
        message: i18n.t('ModUI.retryBlockedUninstalled', {
          modId: normalizedModId,
          defaultValue: `Mod ${normalizedModId} is uninstalled. Install it in Mod Hub before retrying.`,
        }),
    });
    return;
  }

  input.context.clearModFuse(normalizedModId);
  logRendererEvent({
    level: 'info',
    area: 'mod-ui',
    message: 'mod-ui:mod-retry:start',
    details: {
      modId: normalizedModId,
    },
  });

  try {
    const failures: RuntimeModRegisterFailure[] = [];
    const sideloadDiscoverFailures: RuntimeModRegisterFailure[] = [];
    const injectedResult = await registerInjectedRuntimeMods();
    failures.push(...injectedResult.failedMods);

    const eligibleManifests = input.localManifestSummaries.filter((manifest) => {
      const modId = String(manifest?.id || '').trim();
      if (!modId) return false;
      if (input.runtimeModDisabledIds.includes(modId)) return false;
      if (input.runtimeModUninstalledIds.includes(modId)) return false;
      return true;
    });

    if (eligibleManifests.length > 0) {
      const sideloadRegistrations = await discoverSideloadRuntimeMods({
        manifests: eligibleManifests,
        readEntry: (entryPath) => desktopBridge.readRuntimeLocalModEntry(entryPath),
        onError: ({ manifestId, error }) => {
          sideloadDiscoverFailures.push({
            modId: manifestId,
            sourceType: 'sideload',
            stage: 'discover',
            error: safeErrorMessage(error),
          });
        },
      });
      if (sideloadRegistrations.length > 0) {
        const sideloadResult = await registerRuntimeMods(sideloadRegistrations, {
          replaceExisting: true,
        });
        failures.push(...sideloadResult.failedMods);
      }
    }
    failures.push(...sideloadDiscoverFailures);

    input.setRuntimeModFailures(failures);
    await syncSingleRuntimeModShellState(normalizedModId, input.localManifestSummaries);

    const failed = failures.find((item) => item.modId === normalizedModId);
    if (failed) {
      input.context.markModFused(normalizedModId, failed.error, failed.stage);
      input.setStatusBanner({
        kind: 'error',
        message: i18n.t('ModUI.retryFailed', {
          modId: normalizedModId,
          error: failed.error,
          defaultValue: `Mod ${normalizedModId} retry failed: ${failed.error}`,
        }),
      });
      logRendererEvent({
        level: 'warn',
        area: 'mod-ui',
        message: 'mod-ui:mod-retry:failed',
        details: {
          modId: normalizedModId,
          error: failed.error,
        },
      });
      return;
    }

    input.context.clearModFuse(normalizedModId);
    input.setStatusBanner({
      kind: 'success',
      message: i18n.t('ModUI.retryRecovered', {
        modId: normalizedModId,
        defaultValue: `Mod ${normalizedModId} recovered`,
      }),
    });
    logRendererEvent({
      level: 'info',
      area: 'mod-ui',
      message: 'mod-ui:mod-retry:done',
      details: {
        modId: normalizedModId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'retry failed');
    input.context.markModFused(normalizedModId, message, 'retry-failed');
    input.setStatusBanner({
      kind: 'error',
      message: i18n.t('ModUI.retryException', {
        modId: normalizedModId,
        error: message,
        defaultValue: `Mod ${normalizedModId} retry exception: ${message}`,
      }),
    });
    logRendererEvent({
      level: 'error',
      area: 'mod-ui',
      message: 'mod-ui:mod-retry:failed',
      details: {
        modId: normalizedModId,
        error: message,
      },
    });
  }
}
