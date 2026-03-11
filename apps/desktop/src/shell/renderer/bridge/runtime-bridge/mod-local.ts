import { hasTauriInvoke } from './env';
import { invoke, invokeChecked } from './invoke';
import {
  parseRuntimeModDeveloperModeState,
  parseRuntimeModDiagnosticRecords,
  parseRuntimeModInstallProgressEvent,
  parseRuntimeModInstallProgressEvents,
  parseRuntimeModInstallResult,
  parseRuntimeModReloadResults,
  parseRuntimeModSourceChangeEvent,
  parseRuntimeModSourceRecords,
  parseRuntimeModStorageDirs,
  parseRuntimeLocalManifestSummaries,
  parseRuntimeLocalManifestSummary,
  type RuntimeModDeveloperModeState,
  type RuntimeModDiagnosticRecord,
  type RuntimeModInstallPayload,
  type RuntimeModInstallProgressEvent,
  type RuntimeModInstallResult,
  type RuntimeModReloadResult,
  type RuntimeModSourceChangeEvent,
  type RuntimeModSourceRecord,
  type RuntimeModStorageDirs,
  type RuntimeModUpdatePayload,
  type RuntimeLocalManifestSummary,
} from './types';

type TauriEventUnsubscribe = () => void;
type TauriListenResult = Promise<TauriEventUnsubscribe | undefined> | TauriEventUnsubscribe | undefined;

const RUNTIME_MOD_INSTALL_PROGRESS_EVENT = 'runtime-mod://install-progress';
const RUNTIME_MOD_SOURCE_CHANGED_EVENT = 'runtime-mod://source-changed';
const RUNTIME_MOD_RELOAD_RESULT_EVENT = 'runtime-mod://reload-result';

function resolveTauriEventListen(): ((eventName: string, handler: (event: { payload: unknown }) => void) => TauriListenResult) | null {
  const listenFn = window.__TAURI__?.event?.listen;
  if (typeof listenFn !== 'function') {
    return null;
  }
  return listenFn.bind(window.__TAURI__?.event);
}

export async function listRuntimeLocalModManifests(): Promise<RuntimeLocalManifestSummary[]> {
  if (!hasTauriInvoke()) {
    return [];
  }

  return invokeChecked('runtime_mod_list_local_manifests', {}, parseRuntimeLocalManifestSummaries);
}

export async function readRuntimeLocalModEntry(path: string): Promise<string> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_mod_read_local_entry requires Tauri runtime');
  }

  return invokeChecked('runtime_mod_read_local_entry', {
    payload: {
      path,
    },
  }, (result) => {
    if (typeof result !== 'string') {
      throw new Error('runtime_mod_read_local_entry returned non-string payload');
    }
    return result;
  });
}

export async function listInstalledRuntimeMods(): Promise<RuntimeLocalManifestSummary[]> {
  if (!hasTauriInvoke()) {
    return [];
  }
  return invokeChecked('runtime_mod_list_installed', {}, parseRuntimeLocalManifestSummaries);
}

export async function listRuntimeModSources(): Promise<RuntimeModSourceRecord[]> {
  if (!hasTauriInvoke()) {
    return [];
  }
  return invokeChecked('runtime_mod_sources_list', {}, parseRuntimeModSourceRecords);
}

export async function upsertRuntimeModSource(input: {
  sourceId?: string;
  sourceType: 'dev';
  sourceDir: string;
  enabled?: boolean;
}): Promise<RuntimeModSourceRecord> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_mod_sources_upsert requires Tauri runtime');
  }
  return invokeChecked('runtime_mod_sources_upsert', {
    payload: input,
  }, (value) => parseRuntimeModSourceRecords([value])[0]!);
}

export async function removeRuntimeModSource(sourceId: string): Promise<boolean> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_mod_sources_remove requires Tauri runtime');
  }
  return invoke('runtime_mod_sources_remove', {
    payload: { sourceId },
  }).then((value) => Boolean(value));
}

export async function getRuntimeModDeveloperMode(): Promise<RuntimeModDeveloperModeState> {
  if (!hasTauriInvoke()) {
    return { enabled: false, autoReloadEnabled: false };
  }
  return invokeChecked('runtime_mod_dev_mode_get', {}, parseRuntimeModDeveloperModeState);
}

export async function setRuntimeModDeveloperMode(input: {
  enabled: boolean;
  autoReloadEnabled?: boolean;
}): Promise<RuntimeModDeveloperModeState> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_mod_dev_mode_set requires Tauri runtime');
  }
  return invokeChecked('runtime_mod_dev_mode_set', {
    payload: input,
  }, parseRuntimeModDeveloperModeState);
}

export async function getRuntimeModStorageDirs(): Promise<RuntimeModStorageDirs> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_mod_storage_dirs_get requires Tauri runtime');
  }
  return invokeChecked('runtime_mod_storage_dirs_get', {}, parseRuntimeModStorageDirs);
}

export async function setRuntimeModDataDir(nimiDataDir: string): Promise<RuntimeModStorageDirs> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_mod_data_dir_set requires Tauri runtime');
  }
  return invokeChecked('runtime_mod_data_dir_set', {
    payload: { nimiDataDir },
  }, parseRuntimeModStorageDirs);
}

export async function listRuntimeModDiagnostics(): Promise<RuntimeModDiagnosticRecord[]> {
  if (!hasTauriInvoke()) {
    return [];
  }
  return invokeChecked('runtime_mod_diagnostics_list', {}, parseRuntimeModDiagnosticRecords);
}

export async function reloadRuntimeMod(modId: string): Promise<RuntimeModReloadResult[]> {
  if (!hasTauriInvoke()) {
    return [];
  }
  return invokeChecked('runtime_mod_reload', {
    payload: { modId },
  }, parseRuntimeModReloadResults);
}

export async function reloadAllRuntimeMods(): Promise<RuntimeModReloadResult[]> {
  if (!hasTauriInvoke()) {
    return [];
  }
  return invokeChecked('runtime_mod_reload_all', {}, parseRuntimeModReloadResults);
}

export async function openRuntimeModDir(path: string): Promise<void> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_mod_open_dir requires Tauri runtime');
  }
  await invoke('runtime_mod_open_dir', {
    payload: { path },
  });
}

export async function installRuntimeMod(payload: RuntimeModInstallPayload): Promise<RuntimeModInstallResult> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_mod_install requires Tauri runtime');
  }
  return invokeChecked('runtime_mod_install', { payload }, parseRuntimeModInstallResult);
}

export async function updateRuntimeMod(payload: RuntimeModUpdatePayload): Promise<RuntimeModInstallResult> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_mod_update requires Tauri runtime');
  }
  return invokeChecked('runtime_mod_update', { payload }, parseRuntimeModInstallResult);
}

export async function uninstallRuntimeMod(modId: string): Promise<RuntimeLocalManifestSummary> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_mod_uninstall requires Tauri runtime');
  }
  return invokeChecked('runtime_mod_uninstall', {
    payload: {
      modId,
    },
  }, parseRuntimeLocalManifestSummary);
}

export async function readInstalledRuntimeModManifest(input: {
  modId?: string;
  path?: string;
}): Promise<RuntimeLocalManifestSummary> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_mod_read_manifest requires Tauri runtime');
  }
  return invokeChecked('runtime_mod_read_manifest', { payload: input }, parseRuntimeLocalManifestSummary);
}

export async function listRuntimeModInstallProgress(
  installSessionId?: string,
): Promise<RuntimeModInstallProgressEvent[]> {
  if (!hasTauriInvoke()) {
    return [];
  }
  return invokeChecked('runtime_mod_install_progress', {
    payload: installSessionId ? { installSessionId } : {},
  }, parseRuntimeModInstallProgressEvents);
}

export async function subscribeRuntimeModInstallProgress(
  listener: (event: RuntimeModInstallProgressEvent) => void,
): Promise<() => void> {
  const listen = resolveTauriEventListen();
  if (!listen) {
    return () => {};
  }

  const unsubscribe = await Promise.resolve(listen(RUNTIME_MOD_INSTALL_PROGRESS_EVENT, (event) => {
    listener(parseRuntimeModInstallProgressEvent(event.payload));
  }));
  if (typeof unsubscribe === 'function') {
    return unsubscribe;
  }
  return () => {};
}

export async function subscribeRuntimeModSourceChanged(
  listener: (event: RuntimeModSourceChangeEvent) => void,
): Promise<() => void> {
  const listen = resolveTauriEventListen();
  if (!listen) {
    return () => {};
  }
  const unsubscribe = await Promise.resolve(listen(RUNTIME_MOD_SOURCE_CHANGED_EVENT, (event) => {
    listener(parseRuntimeModSourceChangeEvent(event.payload));
  }));
  if (typeof unsubscribe === 'function') {
    return unsubscribe;
  }
  return () => {};
}

export async function subscribeRuntimeModReloadResult(
  listener: (event: RuntimeModReloadResult) => void,
): Promise<() => void> {
  const listen = resolveTauriEventListen();
  if (!listen) {
    return () => {};
  }
  const unsubscribe = await Promise.resolve(listen(RUNTIME_MOD_RELOAD_RESULT_EVENT, (event) => {
    listener(parseRuntimeModReloadResults([event.payload])[0]!);
  }));
  if (typeof unsubscribe === 'function') {
    return unsubscribe;
  }
  return () => {};
}
