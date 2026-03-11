import {
  desktopBridge,
  type RuntimeLocalManifestSummary,
  type RuntimeModDeveloperModeState,
  type RuntimeModDiagnosticRecord,
  type RuntimeModSourceRecord,
} from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { listRegisteredRuntimeModIds } from '@runtime/mod';
import { syncRuntimeModStyles } from './runtime-mod-styles';
import { syncRuntimeUiExtensionsToRegistry } from './sync-runtime-extensions';

export async function refreshRuntimeModDeveloperHostState(): Promise<{
  manifests: RuntimeLocalManifestSummary[];
  sources: RuntimeModSourceRecord[];
  developerMode: RuntimeModDeveloperModeState;
  diagnostics: RuntimeModDiagnosticRecord[];
}> {
  const [manifests, sources, developerMode, diagnostics] = await Promise.all([
    desktopBridge.listRuntimeLocalModManifests(),
    desktopBridge.listRuntimeModSources(),
    desktopBridge.getRuntimeModDeveloperMode(),
    desktopBridge.listRuntimeModDiagnostics(),
  ]);
  const appStore = useAppStore.getState();
  appStore.setLocalManifestSummaries(manifests);
  appStore.setRuntimeModSources(sources);
  appStore.setRuntimeModDeveloperMode(developerMode);
  appStore.setRuntimeModDiagnostics(diagnostics);
  return {
    manifests,
    sources,
    developerMode,
    diagnostics,
  };
}

export async function refreshRuntimeManifestSummaries(): Promise<RuntimeLocalManifestSummary[]> {
  return (await refreshRuntimeModDeveloperHostState()).manifests;
}

export async function syncRuntimeModShellState(
  manifests: RuntimeLocalManifestSummary[] = useAppStore.getState().localManifestSummaries,
): Promise<string[]> {
  const registeredRuntimeModIds = listRegisteredRuntimeModIds();
  const appStore = useAppStore.getState();
  appStore.setRegisteredRuntimeModIds(registeredRuntimeModIds);
  await syncRuntimeModStyles({
    manifests,
    activeModIds: registeredRuntimeModIds,
  });
  syncRuntimeUiExtensionsToRegistry();
  return registeredRuntimeModIds;
}
