import {
  desktopBridge,
  type RuntimeLocalManifestSummary,
  type RuntimeModReloadResult,
} from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  discoverSideloadRuntimeMods,
  listRegisteredRuntimeModIds,
  registerRuntimeMods,
  unregisterRuntimeMods,
  type RuntimeModRegisterFailure,
} from '@runtime/mod';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { i18n } from '@renderer/i18n';
import { refreshRuntimeModDeveloperHostState, syncRuntimeModShellState } from './runtime-mod-shell-state';
import { removeRuntimeModStyles } from './runtime-mod-styles';

function normalizeModId(modId: string): string {
  return String(modId || '').trim();
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

function reportDeveloperHostSubscriptionError(stage: string, error: unknown): void {
  const message = safeErrorMessage(error);
  useAppStore.getState().setStatusBanner({
    kind: 'error',
    message: i18n.t('ModUI.developerHostSubscriptionError', {
      stage,
      error: message,
      defaultValue: `Runtime mod developer host failed during ${stage}: ${message}`,
    }),
  });
  logRendererEvent({
    level: 'error',
    area: 'mod-ui',
    message: 'mod-ui:developer-host-subscription-failed',
    details: {
      stage,
      error: message,
    },
  });
}

export async function reconcileRuntimeLocalMods(input?: {
  manifests?: RuntimeLocalManifestSummary[];
}): Promise<{
  manifests: RuntimeLocalManifestSummary[];
  failures: RuntimeModRegisterFailure[];
}> {
  const appStore = useAppStore.getState();
  const previousManifests = appStore.localManifestSummaries;
  const manifests = input?.manifests ?? (await refreshRuntimeModDeveloperHostState()).manifests;
  const disabledSet = new Set(appStore.runtimeModDisabledIds.map(normalizeModId).filter(Boolean));
  const uninstalledSet = new Set(appStore.runtimeModUninstalledIds.map(normalizeModId).filter(Boolean));
  const eligibleManifests = manifests.filter((manifest) => {
    const modId = normalizeModId(manifest.id);
    if (!modId) return false;
    if (disabledSet.has(modId)) return false;
    if (uninstalledSet.has(modId)) return false;
    return true;
  });
  const eligibleIds = new Set(eligibleManifests.map((item) => normalizeModId(item.id)).filter(Boolean));
  const previousLocalIds = new Set(previousManifests.map((item) => normalizeModId(item.id)).filter(Boolean));
  const toUnregister = Array.from(previousLocalIds.values()).filter((modId) => !eligibleIds.has(modId));
  if (toUnregister.length > 0) {
    unregisterRuntimeMods(toUnregister);
    for (const modId of toUnregister) {
      removeRuntimeModStyles(modId);
    }
  }

  const discoverFailures: RuntimeModRegisterFailure[] = [];
  const registrations = await discoverSideloadRuntimeMods({
    manifests: eligibleManifests,
    readEntry: (entryPath) => desktopBridge.readRuntimeLocalModEntry(entryPath),
    onError: ({ manifestId, error }) => {
      discoverFailures.push({
        modId: manifestId,
        sourceType: 'sideload',
        stage: 'discover',
        error: safeErrorMessage(error),
      });
    },
  });
  const registerResult = registrations.length > 0
    ? await registerRuntimeMods(registrations, { replaceExisting: true })
    : { registeredModIds: [] as string[], failedMods: [] as RuntimeModRegisterFailure[] };
  const localFailures = [...discoverFailures, ...registerResult.failedMods];
  const localFailureIds = new Set([
    ...Array.from(previousLocalIds.values()),
    ...manifests.map((item) => normalizeModId(item.id)).filter(Boolean),
    'runtime.local-manifest-scan',
  ]);
  const preservedFailures = appStore.runtimeModFailures.filter((item) => !localFailureIds.has(item.modId));
  appStore.setRuntimeModFailures([...preservedFailures, ...localFailures]);
  await syncRuntimeModShellState(manifests);
  return {
    manifests,
    failures: localFailures,
  };
}

let runtimeModDeveloperHostSubscriptionsAttached = false;
let runtimeModDeveloperHostSubscriptionsPromise: Promise<void> | null = null;

export async function attachRuntimeModDeveloperHostSubscriptions(): Promise<void> {
  if (!desktopBridge.hasTauriInvoke()) {
    return;
  }
  if (runtimeModDeveloperHostSubscriptionsAttached) {
    return;
  }
  if (runtimeModDeveloperHostSubscriptionsPromise) {
    return runtimeModDeveloperHostSubscriptionsPromise;
  }

  runtimeModDeveloperHostSubscriptionsPromise = (async () => {
    try {
      await desktopBridge.subscribeRuntimeModSourceChanged(async () => {
        try {
          await reconcileRuntimeLocalMods();
        } catch (error) {
          reportDeveloperHostSubscriptionError('source-change', error);
        }
      });
      await desktopBridge.subscribeRuntimeModReloadResult((event: RuntimeModReloadResult) => {
        try {
          useAppStore.getState().pushRuntimeModReloadResults([event]);
        } catch (error) {
          reportDeveloperHostSubscriptionError('reload-result', error);
        }
      });
      runtimeModDeveloperHostSubscriptionsAttached = true;
    } catch (error) {
      runtimeModDeveloperHostSubscriptionsAttached = false;
      reportDeveloperHostSubscriptionError('attach', error);
      throw error;
    } finally {
      runtimeModDeveloperHostSubscriptionsPromise = null;
    }
  })();

  return runtimeModDeveloperHostSubscriptionsPromise;
}

export function getRegisteredRuntimeLocalModIds(): string[] {
  const localIds = new Set(useAppStore.getState().localManifestSummaries.map((item) => normalizeModId(item.id)).filter(Boolean));
  return listRegisteredRuntimeModIds().filter((modId) => localIds.has(normalizeModId(modId)));
}
